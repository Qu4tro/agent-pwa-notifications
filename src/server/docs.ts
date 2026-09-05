import { json } from './util'

// Human/agent-readable description of the block contract. Served at
// /api/v1/schema.json and linked from the skill + MCP tool descriptions.
export function blockSchemaDoc(): Response {
  return json(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Agent PWA Notifications blocks',
      description:
        'A JSON array of typed UI blocks. Display blocks work in any event. Interactive blocks (buttons, form) are only valid on a question.',
      blocks: {
        markdown: {
          type: 'markdown',
          text: 'string (a markdown subset: # ## ### headings, - or * bullet lists, ``` fenced code, **bold**, `code`, [label](url) and bare http(s) links. Every other line is a paragraph; anything outside the list renders as plain text.)',
        },
        progress: { type: 'progress', label: 'string?', value: 'number', max: 'number (default 100)' },
        keyvalue: { type: 'keyvalue', items: '[{ k: string, v: string }]' },
        table: { type: 'table', columns: 'string[]', rows: 'string[][]' },
        link: { type: 'link', url: 'string(url)', label: 'string?' },
        image: { type: 'image', url: 'string(url)', alt: 'string?' },
        code: { type: 'code', lang: 'string?', text: 'string' },
        callout: { type: 'callout', tone: 'info|success|warn|error', text: 'string' },
        buttons: {
          type: 'buttons',
          id: 'string',
          options: 'string[] (the choices)',
          colors:
            'string[]? (one per option, in the same order: blue|violet|mint|rose|amber|cyan|pink|lime, or #rrggbb. Leave it out: options are shown in a neutral colour, a plain affirmative ("Yes", "Approve", "Go ahead") first and a plain denial ("No", "Reject", "Not now") last, whatever order you send. Add it only when a particular choice should read a particular way; a plain "No" is not a danger and needs no red.)',
        },
        form: {
          type: 'form',
          id: 'string',
          submitLabel: 'string?',
          fields:
            '[{ id: string, kind: "text|textarea|number|select|radio|checkbox", label: string, options?: string[], required?: boolean, placeholder?: string }]',
        },
      },
      examples: {
        update: [
          { type: 'markdown', text: '## Research complete\nFound 14 competitors.' },
          { type: 'progress', label: 'Sources scraped', value: 14, max: 14 },
        ],
        question_form: [
          { type: 'markdown', text: 'Ready to draft the deck. A few choices:' },
          {
            type: 'form',
            id: 'deck',
            submitLabel: 'Build it',
            fields: [
              { id: 'audience', kind: 'select', label: 'Audience', options: ['VC', 'Customer', 'Internal'] },
              { id: 'tone', kind: 'radio', label: 'Tone', options: ['Formal', 'Punchy'] },
              { id: 'notes', kind: 'textarea', label: 'Anything to emphasize?' },
            ],
          },
        ],
        question_buttons: [
          { type: 'markdown', text: 'About to deploy to production. Go?' },
          { type: 'buttons', id: 'confirm', options: ['Deploy', 'Cancel'], colors: ['mint', 'rose'] },
        ],
      },
      // An answer is one document in two parts. `answer` holds the values of
      // the controls, keyed by block id; `text` holds the human's own words.
      // They are siblings, so no block id can collide with the words. Either
      // part may be empty, and at least one is filled.
      answers: {
        description:
          'What GET /api/v1/questions/{id} returns as `answer` and `text`. Every question takes words, whatever controls it carries.',
        buttons: { answer: { confirm: 'Deploy' }, text: null },
        form: {
          answer: { deck: { audience: 'VC', tone: 'Punchy', notes: 'Keep it to ten slides.' } },
          text: null,
        },
        both: { answer: { confirm: 'Deploy' }, text: 'after the demo, not before' },
        words_alone: { answer: {}, text: 'wait for QA to sign off' },
      },
    },
    200,
    { 'access-control-allow-origin': '*' },
  )
}

// An agent that moved on has no poll running, so a changed answer rides on the
// next call it makes on the thread.
const CHANGED_ANSWERS =
  ' Carries `changed_answers` when the human replaced an answer on this thread and no poll has collected it since: read each item, then poll its id to acknowledge it.'

// Blocks arrive one of two ways: a plain JSON array the server validates, or,
// with `enc: true`, one ciphertext string the server stores and never reads.
const BLOCKS_PROPERTY = {
  description: 'Display blocks. A JSON array, or the ciphertext string when `enc` is true. See /api/v1/schema.json.',
  oneOf: [{ type: 'array', items: { type: 'object' } }, { type: 'string' }],
}

const ENC_PROPERTY = {
  type: 'boolean',
  description: 'Send `blocks` as one ciphertext string. The server stores it as it is; the app decrypts it.',
}

export function openApiDoc(origin: string): Response {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Agent PWA Notifications',
      version: __APP_VERSION__,
      description:
        'Push updates and ask-and-wait questions from AI agents to one human. Bearer auth with the account agent key.',
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ bearer: [] }],
    paths: {
      '/api/v1/events': {
        post: {
          operationId: 'notify',
          summary: 'Push an update notification.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    agent: { type: 'string', description: 'The tool you run in, e.g. "cursor".' },
                    task_id: { type: 'string', description: 'Stable key that threads every call of one task together.' },
                    project: { type: 'string', description: 'Project name. Groups and filters the dashboard.' },
                    task: { type: 'string', description: 'Current task, e.g. "Adding children mode".' },
                    model: { type: 'string', description: 'Which model you are, e.g. "opus-4.8".' },
                    kind: { type: 'string', enum: ['update', 'done', 'error'] },
                    priority: { type: 'integer', enum: [0, 1, 2] },
                    blocks: BLOCKS_PROPERTY,
                    enc: ENC_PROPERTY,
                    idle_minutes: {
                      type: 'integer',
                      description:
                        'Minutes of silence that still count as working. Default 240. The thread leaves Active once a `done` arrives or this passes.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Created.' + CHANGED_ANSWERS,
              content: { 'application/json': {} },
            },
          },
        },
      },
      '/api/v1/questions': {
        post: {
          operationId: 'ask',
          summary: 'Ask a question (must include a buttons or form block).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'blocks'],
                  properties: {
                    title: { type: 'string' },
                    blocks: BLOCKS_PROPERTY,
                    enc: ENC_PROPERTY,
                    ack: {
                      type: 'string',
                      description:
                        'Shown to the human the instant they answer, e.g. "Got it - proceeding with {answer}." {answer} stands for their choice.',
                    },
                    timeout_minutes: { type: 'integer' },
                    idle_minutes: { type: 'integer' },
                    task_id: { type: 'string' },
                    agent: { type: 'string' },
                    project: { type: 'string' },
                    task: { type: 'string' },
                    model: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Created; returns id + poll_url.' + CHANGED_ANSWERS } },
        },
      },
      '/api/v1/questions/{id}': {
        get: {
          operationId: 'wait_for_answer',
          summary: 'Poll for the answer. Repeat every ~10s while status is pending.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description:
                'status: pending | answered | expired, answer (the values keyed by block id, {} when only words were sent), text (the human own words, or null), answered_at, changes (how many times the answer was replaced after it was first given).',
            },
          },
        },
      },
      // POST /api/v1/questions/{id}/answer is the human's route, behind the
      // session cookie. An agent key is rejected there, so it stays out of this
      // spec.
      '/api/v1/inbox': {
        get: {
          operationId: 'inbox',
          summary: 'List recent events (dedupe / resume).',
          parameters: [
            { name: 'agent', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Recent events' } },
        },
      },
      '/api/v1/events/{id}': {
        post: {
          operationId: 'update',
          summary: 'Replace an existing event in place (live progress).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    blocks: BLOCKS_PROPERTY,
                    enc: ENC_PROPERTY,
                    kind: { type: 'string', enum: ['update', 'done', 'error'] },
                    idle_minutes: { type: 'integer' },
                    priority: { type: 'integer', enum: [0, 1, 2] },
                    project: { type: 'string' },
                    task: { type: 'string' },
                    model: { type: 'string' },
                    notify: { type: 'boolean', description: 'Push this update. Default false - silent progress ticks.' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Updated.' + CHANGED_ANSWERS } },
        },
      },
      '/api/v1/clear': {
        post: {
          operationId: 'clear',
          summary: "Remove seen or settled events ('read'), or everything ('all').",
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    scope: { type: 'string', enum: ['read', 'all'] },
                    project: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Returns the number of events removed' } },
        },
      },
      '/api/v1/login-link': {
        post: {
          operationId: 'login_link',
          summary: 'Mint a one-time link that signs the human in on any device.',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    next: { type: 'string', description: 'Same-origin path to land on. Default "/".' },
                    ttl_minutes: { type: 'integer', minimum: 1, maximum: 60, default: 15 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Returns url and expires_at' } },
        },
      },
    },
  }
  return json(spec, 200, { 'access-control-allow-origin': '*' })
}
