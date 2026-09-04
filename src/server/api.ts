import type { Env } from './env'
import { json, ulid, now } from './util'
import { BlocksSchema, hasInteractive, answerTargets, type Block } from './blocks'
import { pushToAll, type PushSubscription } from './push'
import { pokeHub } from './hub'
import { quickAnswerActions, previewText } from './quick-answers'

// Every exported handler takes the resolved `accountId` and scopes all data to
// it. This is the tenant boundary - miss it on any query and one user could see
// or mutate another's inbox.

// -- retention / settings helpers ---------------------------------------------
function retentionMs(env: Env): number {
  const days = Number(env.EVENT_RETENTION_DAYS ?? '90')
  return Math.max(1, days) * 86_400_000
}

async function getSetting(env: Env, accountId: string, key: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT value FROM account_settings WHERE account_id = ?1 AND key = ?2',
  )
    .bind(accountId, key)
    .first<{ value: string }>()
  return row?.value ?? null
}

async function setSetting(env: Env, accountId: string, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO account_settings (account_id, key, value) VALUES (?1, ?2, ?3)
     ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value`,
  )
    .bind(accountId, key, value)
    .run()
}

// Quiet hours: suppress non-urgent push between start/end (minutes since UTC
// midnight, offset by the user's saved tz). Urgent (priority 2) always rings.
async function inQuietHours(env: Env, accountId: string): Promise<boolean> {
  const raw = await getSetting(env, accountId, 'quiet_hours')
  if (!raw) return false
  try {
    const { start, end, offsetMin } = JSON.parse(raw) as {
      start: number
      end: number
      offsetMin: number
    }
    if (start === end) return false
    const local = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + (offsetMin ?? 0) + 1440) % 1440
    return start < end ? local >= start && local < end : local >= start || local < end
  } catch {
    return false
  }
}

async function maybePush(env: Env, accountId: string, event: EventRow): Promise<void> {
  const wants = event.kind === 'question' || event.priority >= 1
  if (!wants) return
  if (event.priority < 2 && (await inQuietHours(env, accountId))) return
  await pushToAll(env, accountId, {
    title: event.project ? `${event.project}: ${event.title}` : event.title,
    // Encrypted events carry ciphertext blocks the server can't read - the
    // notification stays generic; the app decrypts the detail on open.
    body: event.enc ? 'Encrypted. Open to view.' : previewText(JSON.parse(event.blocks)),
    tag: event.task_id || event.id,
    eventId: event.id,
    kind: event.kind,
    priority: event.priority,
    quickAnswers: quickAnswerActions(event),
  })
}

interface EventRow {
  id: string
  agent: string
  task_id: string | null
  kind: string
  title: string
  blocks: string
  priority: number
  created_at: number
  read_at: number | null
  expires_at: number
  project: string | null
  enc: number
}

// Validate/normalize a blocks payload that may be plaintext (a JSON array we
// zod-check) or an encrypted ciphertext string (opaque; stored as-is). Returns
// the string to store + the enc flag, or an error Response.
function normalizeBlocks(
  body: Record<string, unknown>,
  { allowInteractive }: { allowInteractive: boolean },
): { blocks: string; enc: number } | Response {
  if (body.enc === true) {
    if (typeof body.blocks !== 'string' || !body.blocks) {
      return json({ ok: false, error: 'Encrypted events must send blocks as a ciphertext string.' }, 400)
    }
    return { blocks: body.blocks, enc: 1 }
  }
  const parsed = BlocksSchema.safeParse(body.blocks ?? [])
  if (!parsed.success) {
    return json({ ok: false, error: 'Invalid blocks.', detail: parsed.error.issues.slice(0, 5) }, 400)
  }
  if (!allowInteractive && hasInteractive(parsed.data)) {
    return json({ ok: false, error: 'Interactive blocks (buttons/form) are only valid on questions.' }, 400)
  }
  if (allowInteractive && !hasInteractive(parsed.data)) {
    return json({ ok: false, error: 'A question needs at least one interactive block (buttons or form).' }, 400)
  }
  return { blocks: JSON.stringify(parsed.data), enc: 0 }
}

// -- Agent endpoints (bearer agent key -> accountId) ---------------------------

const VALID_KINDS = new Set(['update', 'question', 'done', 'error'])

interface Meta {
  project: string | null
  task: string | null
  model: string | null
  tags: string // JSON array string
  idleMinutes: number | null
}

// How long a thread stays "in progress" with nothing new on it. An agent that
// crashes, or that simply stops, would otherwise leave its thread Active for
// ever, so silence past this counts as finished. Four hours, decided 2026-09-04.
export const DEFAULT_IDLE_MINUTES = 240

// Pull the attribution fields out of a request body, sanitized.
function extractMeta(body: Record<string, unknown>): Meta {
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[])
        .filter((t) => typeof t === 'string' && t.trim())
        .slice(0, 12)
        .map((t) => (t as string).trim().slice(0, 40))
    : []
  // Same bounds as a question timeout: a minute to seven days. Anything the
  // agent does not send stays null, which reads as the default.
  const rawIdle = Number(body.idle_minutes)
  const idleMinutes =
    body.idle_minutes != null && Number.isFinite(rawIdle)
      ? Math.max(1, Math.min(10_080, rawIdle | 0))
      : null
  return {
    project: str(body.project, 120),
    task: str(body.task, 200),
    model: str(body.model, 80),
    tags: JSON.stringify(tags),
    idleMinutes,
  }
}

export async function createEvent(request: Request, env: Env, accountId: string): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  if (!title) return json({ ok: false, error: 'title is required.' }, 400)

  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 120) : 'agent'
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim().slice(0, 120) : null
  let kind = typeof body.kind === 'string' ? body.kind : 'update'
  if (!VALID_KINDS.has(kind)) kind = 'update'
  if (kind === 'question') return json({ ok: false, error: 'Use POST /questions to ask a question.' }, 400)

  const priority = Math.max(0, Math.min(2, Number(body.priority ?? 0) | 0))

  const norm = normalizeBlocks(body, { allowInteractive: false })
  if (norm instanceof Response) return norm

  const meta = extractMeta(body)
  const id = ulid()
  const t = now()
  await env.DB.prepare(
    `INSERT INTO events (id, account_id, agent, task_id, kind, title, blocks, priority, created_at, updated_at, expires_at, project, task, model, tags, enc, idle_minutes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
  )
    .bind(id, accountId, agent, taskId, kind, title, norm.blocks, priority, t, t + retentionMs(env), meta.project, meta.task, meta.model, meta.tags, norm.enc, meta.idleMinutes)
    .run()

  const event: EventRow = {
    id, agent, task_id: taskId, kind, title,
    blocks: norm.blocks, priority, created_at: t, read_at: null,
    expires_at: t + retentionMs(env), project: meta.project, enc: norm.enc,
  }
  await maybePush(env, accountId, event)
  await pokeHub(env, accountId)
  return json({ ok: true, id })
}

// Patch an existing event in place - the primitive behind live progress. The
// agent POSTs the id it got back from createEvent, with new blocks/title/kind.
// Pushes only if the caller explicitly asks (avoid buzzing on every % tick).
export async function updateEvent(id: string, request: Request, env: Env, accountId: string): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT id, agent, task_id, kind, priority FROM events WHERE id = ?1 AND account_id = ?2',
  )
    .bind(id, accountId)
    .first<{ id: string; agent: string; task_id: string | null; kind: string; priority: number }>()
  if (!existing) return json({ ok: false, error: 'Unknown event id.' }, 404)
  if (existing.kind === 'question') {
    return json({ ok: false, error: 'Questions cannot be updated in place.' }, 400)
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  // Resolve the new values, falling back to the existing row where omitted.
  const title =
    typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 300) : null
  const kind =
    typeof body.kind === 'string' && VALID_KINDS.has(body.kind) && body.kind !== 'question'
      ? body.kind
      : null
  const priority =
    body.priority != null ? Math.max(0, Math.min(2, Number(body.priority) | 0)) : existing.priority

  let blocksJson: string | null = null
  let blocks: Block[] | null = null
  let encVal: number | null = null
  if (body.blocks != null) {
    const norm = normalizeBlocks(body, { allowInteractive: false })
    if (norm instanceof Response) return norm
    blocksJson = norm.blocks
    encVal = norm.enc
    if (norm.enc === 0) blocks = JSON.parse(norm.blocks) as Block[]
  }

  // Only overwrite meta fields the caller actually sent (COALESCE on null).
  const project = 'project' in body ? extractMeta(body).project : null
  const task = 'task' in body ? extractMeta(body).task : null
  const model = 'model' in body ? extractMeta(body).model : null
  const tags = 'tags' in body ? extractMeta(body).tags : null
  const idleMinutes = 'idle_minutes' in body ? extractMeta(body).idleMinutes : null

  // COALESCE keeps the old value when we pass null. read_at resets so a fresh
  // update the human hasn't seen shows as unread again.
  await env.DB.prepare(
    `UPDATE events SET
       title = COALESCE(?1, title),
       kind = COALESCE(?2, kind),
       priority = ?3,
       blocks = COALESCE(?4, blocks),
       project = COALESCE(?5, project),
       task = COALESCE(?6, task),
       model = COALESCE(?7, model),
       tags = COALESCE(?8, tags),
       enc = COALESCE(?9, enc),
       idle_minutes = COALESCE(?10, idle_minutes),
       updated_at = ?11,
       read_at = NULL
     WHERE id = ?12 AND account_id = ?13`,
  )
    .bind(title, kind, priority, blocksJson, project, task, model, tags, encVal, idleMinutes, now(), id, accountId)
    .run()

  if (body.notify === true) {
    await pushToAll(env, accountId, {
      title: title ?? 'Update',
      body: encVal === 1 ? 'Encrypted. Open to view.' : blocks ? previewText(blocks) : 'Progress updated.',
      tag: existing.task_id || id,
      eventId: id,
      kind: kind ?? existing.kind,
      priority,
    })
  }
  await pokeHub(env, accountId)
  return json({ ok: true, id })
}

export async function createQuestion(request: Request, env: Env, accountId: string): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  if (!title) return json({ ok: false, error: 'title is required.' }, 400)

  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 120) : 'agent'
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim().slice(0, 120) : null

  // Encrypted questions can't be validated server-side (the interactive block
  // is inside the ciphertext) - we trust the agent and enforce shape client-side.
  const norm = normalizeBlocks(body, { allowInteractive: true })
  if (norm instanceof Response) return norm

  const timeoutMin = Math.max(1, Math.min(10_080, Number(body.timeout_minutes ?? 1440) | 0)) // default 24h, max 7d
  const meta = extractMeta(body)
  const id = ulid()
  const t = now()
  const timeoutAt = t + timeoutMin * 60_000

  const ack = typeof body.ack === 'string' && body.ack.trim() ? body.ack.trim().slice(0, 500) : null
  const batch = [
    env.DB.prepare(
      `INSERT INTO events (id, account_id, agent, task_id, kind, title, blocks, priority, created_at, updated_at, expires_at, project, task, model, tags, enc, ack, idle_minutes)
       VALUES (?1, ?2, ?3, ?4, 'question', ?5, ?6, 2, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    ).bind(id, accountId, agent, taskId, title, norm.blocks, t, t + retentionMs(env), meta.project, meta.task, meta.model, meta.tags, norm.enc, ack, meta.idleMinutes),
    env.DB.prepare(
      `INSERT INTO questions (event_id, status, timeout_at) VALUES (?1, 'pending', ?2)`,
    ).bind(id, timeoutAt),
  ]
  await env.DB.batch(batch)

  const event: EventRow = {
    id, agent, task_id: taskId, kind: 'question', title,
    blocks: norm.blocks, priority: 2, created_at: t, read_at: null,
    expires_at: t + retentionMs(env), project: meta.project, enc: norm.enc,
  }
  await maybePush(env, accountId, event)
  await pokeHub(env, accountId)
  return json({ ok: true, id, poll_url: `/api/v1/questions/${id}`, timeout_at: timeoutAt })
}

// Agent polls this. Also lazily expires the question if its deadline passed, so
// a waiting agent gets a definitive answer instead of hanging forever.
export async function getQuestion(id: string, env: Env, accountId: string): Promise<Response> {
  const q = await env.DB.prepare(
    `SELECT q.status, q.answer, q.answered_at, q.timeout_at, q.picked_up_at, e.enc
     FROM questions q JOIN events e ON e.id = q.event_id
     WHERE q.event_id = ?1 AND e.account_id = ?2`,
  )
    .bind(id, accountId)
    .first<{
      status: string
      answer: string | null
      answered_at: number | null
      timeout_at: number
      picked_up_at: number | null
      enc: number
    }>()

  if (!q) return json({ ok: false, error: 'Unknown question id.' }, 404)

  if (q.status === 'pending' && q.timeout_at < now()) {
    await env.DB.prepare(`UPDATE questions SET status = 'expired' WHERE event_id = ?1`).bind(id).run()
    return json({ ok: true, status: 'expired' })
  }

  // The agent is receiving the answer right now - stamp the delivery receipt
  // (once) so the human's screen can flip to "agent received it", and nudge the
  // live feed so that update is instant.
  if (q.status === 'answered' && q.picked_up_at == null) {
    await env.DB.prepare('UPDATE questions SET picked_up_at = ?1 WHERE event_id = ?2')
      .bind(now(), id)
      .run()
    await pokeHub(env, accountId)
  }

  // Encrypted answers are ciphertext strings - pass through for the agent to
  // decrypt; plaintext answers are JSON.
  const answer = q.answer ? (q.enc === 1 ? q.answer : JSON.parse(q.answer)) : null
  return json({ ok: true, status: q.status, answer, answered_at: q.answered_at })
}

// Agent reads its recent events (dedupe / resume after a crash).
export async function getInbox(url: URL, env: Env, accountId: string): Promise<Response> {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? '30') | 0))
  const agent = url.searchParams.get('agent')
  const q = agent
    ? env.DB.prepare(
        `SELECT id, agent, task_id, kind, title, priority, created_at, project, task, model FROM events
         WHERE account_id = ?1 AND agent = ?2 AND archived_at IS NULL ORDER BY created_at DESC LIMIT ?3`,
      ).bind(accountId, agent, limit)
    : env.DB.prepare(
        `SELECT id, agent, task_id, kind, title, priority, created_at, project, task, model FROM events
         WHERE account_id = ?1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT ?2`,
      ).bind(accountId, limit)
  const { results } = await q.all()
  return json({ ok: true, events: results ?? [] })
}

// Project cards for the landing page: which models are active, how many tasks
// need action, last activity. Sorted so projects needing you float to the top.
export async function getProjects(env: Env, accountId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       COALESCE(e.project, '') AS project,
       COUNT(*) AS total,
       SUM(CASE WHEN e.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
       SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       MAX(e.created_at) AS last_activity,
       GROUP_CONCAT(DISTINCT e.model) AS models
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE e.account_id = ?1 AND e.archived_at IS NULL
     GROUP BY COALESCE(e.project, '')
     ORDER BY pending DESC, last_activity DESC`,
  )
    .bind(accountId)
    .all<{ project: string; total: number; unread: number; pending: number; last_activity: number; models: string | null }>()
  const projects = (results ?? []).map((r) => ({
    project: r.project,
    total: r.total,
    unread: r.unread,
    pending: r.pending,
    last_activity: r.last_activity,
    models: (r.models ?? '').split(',').filter(Boolean),
  }))
  return json({ ok: true, projects })
}

// The thread key: a stable task_id when the agent sent one, else the event's
// own id (a singleton thread). NEVER the human `task` label - labels collide.
const THREAD_KEY_SQL = `COALESCE(NULLIF(e.task_id, ''), e.id)`

// Which of the three sections of the project page a thread belongs in.
//
// This used to be worked out on the client from "is anything unread", which
// made the state a fact about the human: a thread the agent was still working
// on dropped into Done the moment its last update was read. Now the thread
// says it itself - `pending` while a question waits on you, `done` once the
// agent has sent a `done` or gone quiet past its idle timeout, `active`
// otherwise.
//
// An `error` does not finish a thread. An update that went wrong is still an
// update, and the agent may well retry, so the thread stays Active until it
// says done or the silence runs out. Decided 2026-09-04.
export type ThreadState = 'pending' | 'active' | 'done'

// How many of a thread's own event titles the project row shows. The count on
// the row used to be the only trace of everything but the latest one, which
// was note 3: the row said "3" where it could have said what the three were.
const RECENT_ON_A_ROW = 3

// Group rows into one summary per thread. The rows must arrive oldest first
// and may span projects: two projects are allowed to use the same task_id, so
// the map is keyed by both. Shared by the project list and the pending page,
// which is why it is a function and not a loop inside getTasks.
const SELECT_THREAD_ROWS = `SELECT e.*, ${THREAD_KEY_SQL} AS thread_key,
       q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout, q.picked_up_at AS q_picked
     FROM events e LEFT JOIN questions q ON q.event_id = e.id`

function summarizeThreads(rows: Record<string, unknown>[]): any[] {
  const threads = new Map<string, any>()
  for (const row of rows) {
    const key = String(row.thread_key)
    const project = String(row.project ?? '')
    const id = `${project}\u0000${key}`
    let t = threads.get(id)
    if (!t) {
      t = {
        key,
        project,
        task: null,
        model: null,
        agent: null,
        count: 0,
        unread: 0,
        pending: false,
        pending_event_id: null,
        pending_question: null,
        pending_since: null,
        pending_answers: [],
        latest_title: '',
        latest_kind: 'update',
        last_activity: 0,
        idle_minutes: null,
        state: 'active' as ThreadState,
        // Oldest first, newest last, at most RECENT_ON_A_ROW of them.
        recent: [] as {
          id: unknown
          kind: unknown
          title: unknown
          created_at: unknown
          read_at: unknown
          question: { status: unknown; answer: unknown } | null
        }[],
      }
      threads.set(id, t)
    }
    t.count++
    if (row.task) t.task = row.task
    if (row.model) t.model = row.model
    if (row.agent) t.agent = row.agent
    if (row.read_at == null) t.unread++
    // Latest event (rows are ASC, so keep overwriting).
    t.latest_title = row.title
    t.latest_kind = row.kind
    // The latest value the agent set wins; an event that does not carry one
    // leaves the thread's timeout where it was.
    if (row.idle_minutes != null) t.idle_minutes = Number(row.idle_minutes)
    // A sliding window over rows that are already in order, so this costs one
    // push and at most one shift per event.
    t.recent.push({
      id: row.id,
      kind: row.kind,
      title: row.title,
      created_at: row.created_at,
      read_at: row.read_at ?? null,
      // What was decided, so a row can say it. The SELECT already joins
      // questions for the pending check below; this is the same two columns,
      // parsed by the same rule as `hydrate` - ciphertext straight through
      // when the event is encrypted, JSON otherwise.
      question:
        row.q_status != null
          ? {
              status: row.q_status,
              answer: row.q_answer
                ? Number(row.enc ?? 0) === 1
                  ? (row.q_answer as string)
                  : JSON.parse(row.q_answer as string)
                : null,
            }
          : null,
    })
    if (t.recent.length > RECENT_ON_A_ROW) t.recent.shift()
    t.last_activity = Math.max(t.last_activity, Number(row.updated_at ?? row.created_at))
    if (row.q_status === 'pending') {
      t.pending = true
      t.pending_event_id = row.id
      t.pending_question = row.title // what is being asked, shown on the row
      t.pending_since = Number(row.created_at) // how the queue is ordered
      // A micro-question (one buttons block, 2 or 3 short options, not
      // encrypted) can be answered from the list without opening the thread.
      // Same rule, and the same helper, as the notification quick answers.
      t.pending_answers = quickAnswerActions({
        kind: String(row.kind),
        enc: Number(row.enc ?? 0),
        title: String(row.title ?? ''),
        blocks: String(row.blocks ?? '[]'),
      }).map((a) => ({ label: a.title, answer: a.answer }))
    }
  }

  const t0 = now()
  for (const t of threads.values()) {
    const idleMs = (t.idle_minutes ?? DEFAULT_IDLE_MINUTES) * 60_000
    const finished = t.latest_kind === 'done' || t.last_activity + idleMs < t0
    // Something unread keeps a thread out of Done even once it is finished:
    // the human has not seen how it ended yet.
    t.state = t.pending ? 'pending' : !finished || t.unread > 0 ? 'active' : 'done'
  }
  return [...threads.values()]
}

// Task threads within a project, summarized for the project view.
export async function getTasks(project: string, env: Env, accountId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `${SELECT_THREAD_ROWS}
     WHERE e.account_id = ?1 AND e.archived_at IS NULL AND COALESCE(e.project, '') = ?2
     ORDER BY e.created_at ASC`,
  )
    .bind(accountId, project)
    .all<Record<string, unknown>>()

  const list = summarizeThreads(results ?? []).sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? -1 : 1
    return b.last_activity - a.last_activity
  })
  return json({ ok: true, tasks: list })
}

// Note 6: everything waiting on the human, across every project, in one list.
// getStats has the count and getProjects has it per project, but neither can
// say what is being asked; getFeed stops at the 100 most recent events, so a
// question older than that would simply not be there.
//
// Same shape as getTasks, so the pending page renders the same rows as the
// project page. Oldest question first: the one that has been waiting longest
// is the one to answer.
export async function getPending(env: Env, accountId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `${SELECT_THREAD_ROWS}
     WHERE e.account_id = ?1 AND e.archived_at IS NULL
       AND ${THREAD_KEY_SQL} IN (
         SELECT COALESCE(NULLIF(p.task_id, ''), p.id) FROM events p
         JOIN questions pq ON pq.event_id = p.id
         WHERE p.account_id = ?1 AND p.archived_at IS NULL AND pq.status = 'pending'
       )
     ORDER BY e.created_at ASC`,
  )
    .bind(accountId)
    .all<Record<string, unknown>>()

  // The subquery matches on the thread key alone, so a thread in another
  // project that happens to share a task_id comes back too. The filter drops
  // it: only a thread with a question of its own belongs here.
  const list = summarizeThreads(results ?? [])
    .filter((t) => t.pending)
    .sort((a, b) => a.pending_since - b.pending_since)
  return json({ ok: true, pending: list })
}

// All events in one thread, oldest-first. The order here is the order they
// happened in: the thread title is the first event's, `hydrate` and the tests
// read the array by position, and the client reverses it for painting, so the
// question waiting on you is at the top where the reader lands.
export async function getThread(project: string, key: string, env: Env, accountId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout, q.picked_up_at AS q_picked
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE e.account_id = ?1 AND e.archived_at IS NULL AND COALESCE(e.project, '') = ?2
       AND ${THREAD_KEY_SQL} = ?3
     ORDER BY e.created_at ASC`,
  )
    .bind(accountId, project, key)
    .all()
  const events = (results ?? []).map(hydrate)
  if (events.length === 0) return json({ ok: false, error: 'Thread not found.' }, 404)
  // Prefer the most recent non-empty task label as the thread title.
  let task: unknown = null
  for (const e of events) if ((e as Record<string, unknown>).task) task = (e as Record<string, unknown>).task
  return json({ ok: true, thread: { key, project, task, events } })
}

// -- Dashboard endpoints (session cookie -> accountId) -------------------------

// Timestamp-cursor feed for open dashboard tabs. `since_ts` is the newest
// updated_at the tab already has; we return anything created OR updated after
// it - so in-place progress updates flow through, not just brand-new events.
// Ordered by created_at so a card stays put while its progress bar moves.
export async function getFeed(url: URL, env: Env, accountId: string): Promise<Response> {
  const sinceTs = Number(url.searchParams.get('since_ts') ?? '0') || 0
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '100') | 0))
  const rows = await env.DB.prepare(
    `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout, q.picked_up_at AS q_picked
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE e.account_id = ?1 AND e.archived_at IS NULL
       AND COALESCE(e.updated_at, e.created_at) > ?2
     ORDER BY e.created_at DESC LIMIT ?3`,
  )
    .bind(accountId, sinceTs, limit)
    .all()
  return json({ ok: true, events: (rows.results ?? []).map(hydrate) })
}

export async function getEvent(id: string, env: Env, accountId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout, q.picked_up_at AS q_picked
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE e.id = ?1 AND e.account_id = ?2 AND e.archived_at IS NULL`,
  )
    .bind(id, accountId)
    .first()
  if (!row) return json({ ok: false, error: 'Not found.' }, 404)
  return json({ ok: true, event: hydrate(row) })
}

function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  const enc = Number(row.enc ?? 0) === 1
  // Encrypted rows carry ciphertext strings the server can't parse - pass them
  // through untouched; the client decrypts. Plaintext rows are JSON.
  const blocks = enc ? (row.blocks as string) : JSON.parse((row.blocks as string) || '[]')
  const answer = row.q_answer
    ? enc
      ? (row.q_answer as string)
      : JSON.parse(row.q_answer as string)
    : null
  return {
    id: row.id,
    agent: row.agent,
    task_id: row.task_id,
    kind: row.kind,
    title: row.title,
    blocks,
    enc,
    priority: row.priority,
    project: row.project ?? null,
    task: row.task ?? null,
    model: row.model ?? null,
    tags: JSON.parse((row.tags as string) || '[]'),
    ack: row.ack ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    read_at: row.read_at,
    question:
      row.q_status != null
        ? { status: row.q_status, answer, timeout_at: row.q_timeout, picked_up_at: row.q_picked ?? null }
        : null,
  }
}

export async function markRead(id: string, env: Env, accountId: string): Promise<Response> {
  await env.DB.prepare('UPDATE events SET read_at = ?1 WHERE id = ?2 AND account_id = ?3 AND read_at IS NULL')
    .bind(now(), id, accountId)
    .run()
  return json({ ok: true })
}

export async function markAllRead(env: Env, accountId: string): Promise<Response> {
  await env.DB.prepare('UPDATE events SET read_at = ?1 WHERE account_id = ?2 AND read_at IS NULL')
    .bind(now(), accountId)
    .run()
  return json({ ok: true })
}

// Bring an item back to the top by marking it unread again.
export async function markUnread(id: string, env: Env, accountId: string): Promise<Response> {
  await env.DB.prepare('UPDATE events SET read_at = NULL WHERE id = ?1 AND account_id = ?2')
    .bind(id, accountId)
    .run()
  return json({ ok: true })
}

// Clear the inbox. scope:
//   'read' - only items already seen/answered (safe default; keeps unread + pending)
//   'all' - everything, including unanswered questions (a full restart)
// Optionally scoped to a single project. Always scoped to the account.
const CLEAR_CHUNK = 50

export async function clearEvents(
  env: Env,
  accountId: string,
  scope: 'read' | 'all',
  project?: string | null,
): Promise<Response> {
  // account_id is always ?1; project (when present) is ?2. Archived rows are
  // out of the app already and are the one copy that is left, so no clear -
  // not even scope 'all' - touches them.
  const clauses = ['account_id = ?1', 'archived_at IS NULL']
  const bind: unknown[] = [accountId]
  if (project != null) {
    clauses.push(`COALESCE(project, '') = ?2`)
    bind.push(project)
  }
  // Scope 'read' means "seen or settled". A question the human answered (or
  // that expired) is done with, even when it was never marked read, or was
  // flipped back to unread. Anything still waiting on the human survives.
  if (scope !== 'all') {
    clauses.push(
      `(read_at IS NOT NULL OR EXISTS (
         SELECT 1 FROM questions q
         WHERE q.event_id = events.id AND q.status IN ('answered', 'expired')))`,
    )
  }
  const where = clauses.join(' AND ')

  // Snapshot the ids first. The 'read' clause reads the questions table, so
  // deleting the question rows would change which events still match it.
  const { results } = await env.DB.prepare(`SELECT id FROM events WHERE ${where}`)
    .bind(...bind)
    .all<{ id: string }>()
  const ids = results.map((row) => row.id)

  // D1 caps bound parameters per statement, so delete in chunks.
  for (let i = 0; i < ids.length; i += CLEAR_CHUNK) {
    const chunk = ids.slice(i, i + CLEAR_CHUNK)
    const marks = chunk.map((_, n) => `?${n + 1}`).join(', ')
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM questions WHERE event_id IN (${marks})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM events WHERE id IN (${marks})`).bind(...chunk),
    ])
  }
  await pokeHub(env, accountId)
  return json({ ok: true, cleared: ids.length })
}

// -- Archive (session) --------------------------------------------------------
// Note 4: take finished threads out of the app without taking them out of the
// database. An archived event is invisible to every dashboard read and to the
// agent inbox, and no clear - not even scope 'all' - will delete it afterwards.
// Nothing in the app ever lists it again; it is there for whoever goes looking
// in the database.
//
// The client sends the thread keys it is showing under Done, so what you see
// is what goes. A thread with a question still waiting on you is refused, as a
// whole thread: half-archiving one would leave a question in the app with no
// conversation behind it.
const ARCHIVE_CHUNK = 50

export async function archiveThreads(
  request: Request,
  env: Env,
  accountId: string,
): Promise<Response> {
  let body: { project?: unknown; keys?: unknown }
  try {
    body = (await request.json()) as { project?: unknown; keys?: unknown }
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  const project = typeof body.project === 'string' ? body.project : ''
  const keys = Array.isArray(body.keys)
    ? [...new Set(body.keys.filter((k): k is string => typeof k === 'string' && k.trim() !== ''))]
    : []
  if (keys.length === 0) return json({ ok: true, archived: 0 })

  const t = now()
  let archived = 0
  for (let i = 0; i < keys.length; i += ARCHIVE_CHUNK) {
    const chunk = keys.slice(i, i + ARCHIVE_CHUNK)
    const marks = chunk.map((_, n) => `?${n + 3}`).join(', ')
    // Which of the asked-for threads may actually go. Resolved first, so the
    // response counts threads the human recognises rather than rows.
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT ${THREAD_KEY_SQL} AS thread_key
       FROM events e
       WHERE e.account_id = ?1 AND e.archived_at IS NULL AND COALESCE(e.project, '') = ?2
         AND ${THREAD_KEY_SQL} IN (${marks})
         AND ${THREAD_KEY_SQL} NOT IN (
           SELECT COALESCE(NULLIF(p.task_id, ''), p.id) FROM events p
           JOIN questions q ON q.event_id = p.id
           WHERE p.account_id = ?1 AND q.status = 'pending'
         )`,
    )
      .bind(accountId, project, ...chunk)
      .all<{ thread_key: string }>()
    const allowed = (results ?? []).map((r) => r.thread_key)
    if (allowed.length === 0) continue

    const stampMarks = allowed.map((_, n) => `?${n + 4}`).join(', ')
    await env.DB.prepare(
      `UPDATE events SET archived_at = ?1
       WHERE account_id = ?2 AND archived_at IS NULL AND COALESCE(project, '') = ?3
         AND COALESCE(NULLIF(task_id, ''), id) IN (${stampMarks})`,
    )
      .bind(t, accountId, project, ...allowed)
      .run()
    archived += allowed.length
  }

  await pokeHub(env, accountId)
  return json({ ok: true, archived })
}

// You answer a question in the UI. Validate the answer against the question's
// own interactive blocks so a stale/garbage submit can't land.
export async function answerQuestion(id: string, request: Request, env: Env, accountId: string): Promise<Response> {
  const event = await env.DB.prepare('SELECT blocks, enc FROM events WHERE id = ?1 AND account_id = ?2 AND kind = ?3')
    .bind(id, accountId, 'question')
    .first<{ blocks: string; enc: number }>()
  if (!event) return json({ ok: false, error: 'Unknown question.' }, 404)

  const q = await env.DB.prepare('SELECT status FROM questions WHERE event_id = ?1')
    .bind(id)
    .first<{ status: string }>()
  if (!q) return json({ ok: false, error: 'Unknown question.' }, 404)
  if (q.status !== 'pending') return json({ ok: false, error: `Question already ${q.status}.` }, 409)

  let submitted: Record<string, unknown>
  try {
    submitted = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }

  // Encrypted question: the answer arrives as a ciphertext string the server
  // can't (and shouldn't) validate. Store it opaquely for the agent to decrypt.
  if (event.enc === 1) {
    if (submitted.enc !== true || typeof submitted.answer !== 'string' || !submitted.answer) {
      return json({ ok: false, error: 'Encrypted questions need an encrypted answer.' }, 400)
    }
    return settleAnswer(env, accountId, id, submitted.answer)
  }

  const blocks = JSON.parse(event.blocks) as Block[]
  const targets = answerTargets(blocks)
  const answer: Record<string, unknown> = {}

  for (const bId of targets.buttons) {
    if (typeof submitted[bId] === 'string') answer[bId] = submitted[bId]
  }
  for (const form of targets.forms) {
    const raw = submitted[form.id]
    if (raw && typeof raw === 'object') {
      const clean: Record<string, unknown> = {}
      for (const fId of form.fieldIds) {
        if (fId in (raw as Record<string, unknown>)) clean[fId] = (raw as Record<string, unknown>)[fId]
      }
      answer[form.id] = clean
    }
  }

  if (Object.keys(answer).length === 0) {
    return json({ ok: false, error: 'Answer did not match any of the question fields.' }, 400)
  }

  return settleAnswer(env, accountId, id, JSON.stringify(answer))
}

// First answer wins. Two taps can land at once (the phone and a notification
// action), so the write is conditional on the question still being pending and
// the changed-row count decides the winner. The loser gets a 409 and the stored
// answer is never a mix of the two bodies.
async function settleAnswer(
  env: Env,
  accountId: string,
  id: string,
  answer: string,
): Promise<Response> {
  const result = await env.DB.prepare(
    `UPDATE questions SET status = 'answered', answer = ?1, answered_at = ?2
     WHERE event_id = ?3 AND status = 'pending'`,
  )
    .bind(answer, now(), id)
    .run()

  if (result.meta.changes === 0) {
    const current = await env.DB.prepare('SELECT status FROM questions WHERE event_id = ?1')
      .bind(id)
      .first<{ status: string }>()
    if (!current) return json({ ok: false, error: 'Unknown question.' }, 404)
    return json({ ok: false, error: `Question already ${current.status}.` }, 409)
  }

  await env.DB.prepare('UPDATE events SET read_at = COALESCE(read_at, ?1) WHERE id = ?2')
    .bind(now(), id)
    .run()
  await pokeHub(env, accountId)
  return json({ ok: true })
}

// -- Push subscription management (session) -----------------------------------
export async function subscribePush(request: Request, env: Env, accountId: string): Promise<Response> {
  let sub: PushSubscription
  try {
    sub = (await request.json()) as PushSubscription
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return json({ ok: false, error: 'Malformed subscription.' }, 400)
  }
  // endpoint is globally unique; ON CONFLICT re-homes it to the current account
  // (e.g. a shared device that logs into a different account).
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, account_id, endpoint, keys, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, account_id = excluded.account_id`,
  )
    .bind(ulid(), accountId, sub.endpoint, JSON.stringify(sub.keys), now())
    .run()
  return json({ ok: true })
}

export async function unsubscribePush(request: Request, env: Env, accountId: string): Promise<Response> {
  let body: { endpoint?: string }
  try {
    body = (await request.json()) as { endpoint?: string }
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  if (body.endpoint) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1 AND account_id = ?2')
      .bind(body.endpoint, accountId)
      .run()
  }
  return json({ ok: true })
}

// -- Settings (session) -------------------------------------------------------
export async function getSettings(env: Env, accountId: string): Promise<Response> {
  const quiet = await getSetting(env, accountId, 'quiet_hours')
  return json({ ok: true, quiet_hours: quiet ? JSON.parse(quiet) : null })
}

export async function putSettings(request: Request, env: Env, accountId: string): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  if ('quiet_hours' in body) {
    await setSetting(env, accountId, 'quiet_hours', JSON.stringify(body.quiet_hours ?? null))
  }
  return getSettings(env, accountId)
}

export async function getStats(env: Env, accountId: string): Promise<Response> {
  const unread = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE account_id = ?1 AND read_at IS NULL AND archived_at IS NULL')
    .bind(accountId)
    .first<{ n: number }>()
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM questions q JOIN events e ON e.id = q.event_id
     WHERE e.account_id = ?1 AND e.archived_at IS NULL AND q.status = 'pending'`,
  )
    .bind(accountId)
    .first<{ n: number }>()
  return json({ ok: true, unread: unread?.n ?? 0, pending_questions: pending?.n ?? 0 })
}
