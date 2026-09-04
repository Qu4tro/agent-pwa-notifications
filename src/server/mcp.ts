import type { Env } from './env'
import { json } from './util'
import { createEvent, updateEvent, createQuestion, getQuestion, clearEvents } from './api'

// -- Stateless MCP over Streamable HTTP ---------------------------------------
// A plain JSON-RPC POST handler, not Cloudflare's McpAgent (which is a Durable
// Object and would make a DO mandatory). The tools are pure request/response
// with no session state, so a stateless endpoint is all we need. Auth: the
// account's bearer agent key.

const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'notify',
    description:
      'Push an update to the human. Use for milestones, not every step. ALWAYS pass: project (what you are working on), model (which LLM you are), and task_id - generate ONE stable task_id when you start a task and reuse it on EVERY notify/ask for that task, so all its messages thread together in one conversation instead of scattering into separate cards. Set priority 2 for anything that should ring through quiet hours. Send kind:"done" on the LAST message of a task - that is the only thing that moves the thread out of Active on the human\'s dashboard.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short headline / the message itself.' },
        project: { type: 'string', description: 'Project name, e.g. "Weather app". Used to group and filter.' },
        task: { type: 'string', description: 'Current task, e.g. "Adding children mode".' },
        model: { type: 'string', description: 'Which model you are, e.g. "opus-4.8", "gpt-5".' },
        tags: { type: 'array', description: 'Optional freeform tags, e.g. ["backend","urgent"].' },
        blocks: { type: 'array', description: 'Optional display blocks. See /api/v1/schema.json.' },
        priority: { type: 'number', description: '0 info, 1 notify, 2 urgent. Default 0.' },
        task_id: { type: 'string', description: 'Stable key to group updates into one thread / update in place.' },
        agent: { type: 'string', description: 'The tool/client you run in (e.g. "cursor", "zed").' },
        kind: { type: 'string', description: 'update (default) | done | error. done finishes the thread; error does not.' },
        idle_minutes: { type: 'number', description: 'How many minutes of silence still count as working. Once it passes with nothing new on the thread, the dashboard moves the thread out of Active. Default 240 (4h). Set it when you are about to go quiet for longer than that.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update',
    description:
      'Update an existing event in place - the way to send LIVE progress. First call notify to create the event and keep its returned id; then call update repeatedly with new blocks (e.g. a progress block going 0->50->100) to move the same card without spamming new rows. Set notify:true on the final call to push a "done" notification.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The id returned by notify.' },
        title: { type: 'string' },
        blocks: { type: 'array', description: 'New display blocks (replaces the old ones).' },
        kind: { type: 'string', description: 'update | done | error. done finishes the thread; error does not.' },
        idle_minutes: { type: 'number', description: 'How many minutes of silence still count as working. Once it passes with nothing new on the thread, the dashboard moves the thread out of Active. Default 240 (4h). Set it when you are about to go quiet for longer than that.' },
        priority: { type: 'number' },
        notify: { type: 'boolean', description: 'Send a push for this update. Default false - leave off for silent progress ticks.' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'ask',
    description:
      'Ask the human a question and get an id to poll. For answers directly on supported notifications, make it a micro-question: title at most 80 characters, exactly one buttons block, 2 options preferred (3 max), and each option at most 20 characters. Put any context in a markdown block; the notification or More action opens the full thread. Longer choices and forms remain tap-to-open. ALWAYS pass project, model, task, and the SAME task_id used for this task\'s other calls. Returns { id }; then call wait_for_answer.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Question headline. Keep at most 80 characters for notification answers.' },
        project: { type: 'string', description: 'Project name, e.g. "Weather app".' },
        task: { type: 'string', description: 'Current task, e.g. "Adding children mode".' },
        model: { type: 'string', description: 'Which model you are.' },
        tags: { type: 'array', description: 'Optional freeform tags.' },
        ack: {
          type: 'string',
          description:
            'Optional acknowledgment shown to the human the instant they answer, e.g. "Got it - proceeding with {answer}. Watch for updates." Use {answer} as a placeholder for their choice.',
        },
        blocks: {
          type: 'array',
          description:
            'Must include a buttons or form block. Notification answers require exactly one buttons block with 2-3 labels of at most 20 characters each. Put longer context in markdown; e.g. [{"type":"markdown","text":"The checks passed."},{"type":"buttons","id":"go","options":["Ship","Hold"]}]. Every option is already a different colour, and a plain affirmative or denial ("Yes"/"No", "Correct"/"Wrong", "Approve"/"Reject", "Go ahead"/"Not now") comes out green/red on its own - write the plain word and let it. Add "colors" (one per option: blue|violet|mint|rose|amber|cyan|pink|lime or #rrggbb) only when a particular choice should read a particular way; it overrules both of the above, so never use it to paint an affirmative red.',
        },
        timeout_minutes: { type: 'number', description: 'How long to wait before the question expires. Default 1440 (24h).' },
        idle_minutes: { type: 'number', description: 'How many minutes of silence still count as working. Once it passes with nothing new on the thread, the dashboard moves the thread out of Active. Default 240 (4h). Set it when you are about to go quiet for longer than that.' },
        task_id: { type: 'string' },
        agent: { type: 'string' },
      },
      required: ['title', 'blocks'],
    },
  },
  {
    name: 'clear',
    description:
      "Tidy the human's inbox when it's getting cluttered. scope 'read' (the safe default) removes only items they've already seen or answered, keeping anything unread or awaiting an answer. scope 'all' wipes everything - only use 'all' when the human explicitly asked to restart. Optionally limit to one project.",
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: "'read' (default, safe) or 'all' (full reset)." },
        project: { type: 'string', description: 'Only clear this project.' },
      },
    },
  },
  {
    name: 'wait_for_answer',
    description:
      'Check whether the human answered a question. Returns { status: "pending" | "answered" | "expired", answer }. While status is "pending", wait ~10 seconds and call again. When "answered", answer holds the values keyed by each block id. When "expired", proceed with a sensible default.',
    inputSchema: {
      type: 'object',
      properties: { question_id: { type: 'string' } },
      required: ['question_id'],
    },
  },
]

// What `notify` may create. A question is a different tool, with its own
// interactive blocks and its own poll.
const NOTIFY_KINDS = new Set(['update', 'done', 'error'])

// Adapt an existing API handler (which speaks Request/Response) to a tool call
// by synthesizing a Request from the tool arguments.
function fakeRequest(body: unknown): Request {
  return new Request('https://mcp.local/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

async function callTool(name: string, args: Record<string, unknown>, env: Env, accountId: string): Promise<unknown> {
  if (name === 'notify') {
    // `kind` used to be forced to 'update' here, which meant an MCP agent had
    // no way to finish a thread at all. createEvent validates it and rejects
    // 'question', which has its own tool.
    const kind = NOTIFY_KINDS.has(String(args.kind)) ? String(args.kind) : 'update'
    const res = await createEvent(fakeRequest({ ...args, kind }), env, accountId)
    return res.json()
  }
  if (name === 'update') {
    const { event_id, ...rest } = args
    const res = await updateEvent(String(event_id ?? ''), fakeRequest(rest), env, accountId)
    return res.json()
  }
  if (name === 'ask') {
    const res = await createQuestion(fakeRequest(args), env, accountId)
    return res.json()
  }
  if (name === 'wait_for_answer') {
    const id = String(args.question_id ?? '')
    const res = await getQuestion(id, env, accountId)
    return res.json()
  }
  if (name === 'clear') {
    const scope = args.scope === 'all' ? 'all' : 'read'
    const res = await clearEvents(env, accountId, scope, typeof args.project === 'string' ? args.project : undefined)
    return res.json()
  }
  throw new Error(`Unknown tool: ${name}`)
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export async function handleMcp(request: Request, env: Env, accountId: string): Promise<Response> {
  if (request.method === 'GET') {
    // Some clients probe with GET; advertise that we speak JSON-RPC over POST.
    return json({ ok: true, transport: 'streamable-http', protocol: PROTOCOL_VERSION })
  }

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    msg = (await request.json()) as typeof msg
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400)
  }

  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      return json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-pwa-notifications', version: __APP_VERSION__ },
        }),
      )
    case 'notifications/initialized':
      return new Response(null, { status: 202 })
    case 'tools/list':
      return json(rpcResult(id, { tools: TOOLS }))
    case 'tools/call': {
      const toolName = String(params?.name ?? '')
      const args = (params?.arguments ?? {}) as Record<string, unknown>
      try {
        const out = await callTool(toolName, args, env, accountId)
        return json(
          rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(out) }],
          }),
        )
      } catch (e) {
        return json(rpcResult(id, {
          content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
          isError: true,
        }))
      }
    }
    case 'ping':
      return json(rpcResult(id, {}))
    default:
      return json(rpcError(id, -32601, `Method not found: ${method}`))
  }
}
