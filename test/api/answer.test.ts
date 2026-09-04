import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { api, call, createAccount, req, sessionFor, type TestAccount } from '../helpers'

const twoOptions = [{ type: 'buttons', id: 'choice', options: ['Yes', 'No'] }]

async function ask(account: TestAccount, title = 'Ship it?'): Promise<string> {
  const res = await call('POST', '/api/v1/questions', {
    body: { agent: 'tester', title, blocks: twoOptions },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

type StoredAnswer = {
  status: string
  answer: string | null
  text: string | null
  changes: number
  picked_up_at: number | null
}

async function storedAnswer(id: string): Promise<StoredAnswer> {
  const row = await env.DB.prepare(
    'SELECT status, answer, text, changes, picked_up_at FROM questions WHERE event_id = ?1',
  )
    .bind(id)
    .first<StoredAnswer>()
  return row!
}

const formBlock = [
  {
    type: 'form',
    id: 'deck',
    submitLabel: 'Save',
    fields: [
      { id: 'title', kind: 'text', label: 'Title' },
      { id: 'slides', kind: 'number', label: 'Slides' },
    ],
  },
]

async function askWithBlocks(account: TestAccount, blocks: unknown, title = 'Ship it?'): Promise<string> {
  const res = await call('POST', '/api/v1/questions', {
    body: { agent: 'tester', title, blocks },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

// The agent's own read of the question, which is also how it acknowledges an
// answer: the poll stamps the delivery receipt.
async function poll(account: TestAccount, id: string) {
  const res = await call('GET', `/api/v1/questions/${id}`, { auth: { bearer: account.key } })
  expect(res.status).toBe(200)
  return res.body as {
    status: string
    answer: unknown
    text: string | null
    answered_at: number | null
    changes: number
  }
}

// Note 3: an agent may name the colour of an answer, so a particular choice
// reads a particular way. Only a palette name or six hex digits resolves; the
// value ends up in a style attribute, so nothing else may get through.
describe('colors on a buttons block', () => {
  const askWith = (account: TestAccount, colors: unknown) =>
    call('POST', '/api/v1/questions', {
      body: {
        agent: 'tester',
        title: 'Ship it?',
        project: 'colors',
        blocks: [{ type: 'buttons', id: 'choice', options: ['Yes', 'No'], colors }],
      },
      auth: { bearer: account.key },
    })

  it('takes palette names and hex, and carries them to the row', async () => {
    const account = await createAccount('answer-colors-ok@example.invalid')
    const cookie = await sessionFor(account.id)
    const posted = await askWith(account, ['mint', '#1e3a8a'])
    expect(posted.status).toBe(200)

    const tasks = await call('GET', '/api/v1/tasks?project=colors', { auth: { cookie } })
    expect(tasks.status).toBe(200)
    const [task] = tasks.body.tasks as {
      pending_answers: { label: string; color?: string }[]
    }[]
    expect(task.pending_answers).toEqual([
      { label: 'Yes', answer: { choice: 'Yes' }, color: 'mint' },
      { label: 'No', answer: { choice: 'No' }, color: '#1e3a8a' },
    ])
  })

  it('lets an option go without one, and takes its colour from its place', async () => {
    const account = await createAccount('answer-colors-short@example.invalid')
    const cookie = await sessionFor(account.id)
    expect((await askWith(account, ['mint'])).status).toBe(200)

    const tasks = await call('GET', '/api/v1/tasks?project=colors', { auth: { cookie } })
    const [task] = tasks.body.tasks as { pending_answers: { color?: string }[] }[]
    expect(task.pending_answers[0].color).toBe('mint')
    expect(task.pending_answers[1].color).toBeUndefined()
  })

  it('refuses anything that is not a name or six hex digits', async () => {
    const account = await createAccount('answer-colors-bad@example.invalid')
    for (const bad of [['url(x)'], ['red'], ['#fff'], ['mint; color: red'], [12]]) {
      const res = await askWith(account, bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
  })
})

// An answer is one document in two parts: `answer` carries the values of the
// controls the agent sent, keyed by block id, and `text` carries the human's
// own words. At least one part is filled, and the latest document is the
// answer - a submit on an answered question replaces the whole of it and
// counts as a change.
describe('POST /api/v1/questions/:id/answer', () => {
  it('stores the values on their own and marks the event read', async () => {
    const account = await createAccount('answer-ok@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'Yes' } },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, status: 'answered', changes: 0 })
    expect(await storedAnswer(id)).toMatchObject({
      status: 'answered',
      answer: '{"choice":"Yes"}',
      text: null,
    })

    const row = await env.DB.prepare('SELECT read_at FROM events WHERE id = ?1')
      .bind(id)
      .first<{ read_at: number | null }>()
    expect(row!.read_at).not.toBe(null)
  })

  it('takes words on their own on a question made of buttons', async () => {
    const account = await createAccount('answer-words@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { text: '  wait for QA  ' },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(await storedAnswer(id)).toMatchObject({ answer: '{}', text: 'wait for QA' })
  })

  it('takes words on their own on a question made of a form', async () => {
    const account = await createAccount('answer-words-form@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await askWithBlocks(account, formBlock, 'Name the deck')

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { text: 'the old deck still stands' },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(await storedAnswer(id)).toMatchObject({ answer: '{}', text: 'the old deck still stands' })
  })

  it('takes both parts at once', async () => {
    const account = await createAccount('answer-both@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'Yes' }, text: 'but only after lunch' },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(await storedAnswer(id)).toMatchObject({
      answer: '{"choice":"Yes"}',
      text: 'but only after lunch',
    })
  })

  it('keeps a form answer under its block id', async () => {
    const account = await createAccount('answer-form@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await askWithBlocks(account, formBlock, 'Name the deck')

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { deck: { title: 'Launch', slides: 12 } } },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(JSON.parse((await storedAnswer(id)).answer!)).toEqual({
      deck: { title: 'Launch', slides: 12 },
    })
  })

  it('refuses a document with neither values nor words', async () => {
    const account = await createAccount('answer-empty@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    for (const body of [{}, { answer: {} }, { answer: {}, text: '' }, { text: '   ' }]) {
      const res = await call('POST', `/api/v1/questions/${id}/answer`, { body, auth: { cookie } })
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error).toBe('An answer needs a choice, a form, or some words.')
    }
    expect((await storedAnswer(id)).status).toBe('pending')
  })

  it('refuses a value under a key the question never asked for', async () => {
    const account = await createAccount('answer-junk@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { nothing: 'here' } },
      auth: { cookie },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Answer did not match any of the question fields.')
    expect((await storedAnswer(id)).status).toBe('pending')
  })

  it('refuses words past the limit', async () => {
    const account = await createAccount('answer-long@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { text: 'x'.repeat(20_001) },
      auth: { cookie },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Text is too long (20000 characters at most).')
    expect((await storedAnswer(id)).status).toBe('pending')
  })

  it('replaces the whole document on a second answer and counts the change', async () => {
    const account = await createAccount('answer-change@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'Yes' }, text: 'go' },
      auth: { cookie },
    })
    expect((await poll(account, id)).changes).toBe(0)
    expect((await storedAnswer(id)).picked_up_at).not.toBe(null)

    const second = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'No' } },
      auth: { cookie },
    })
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ ok: true, status: 'answered', changes: 1 })

    // A change sends the human's screen back to waiting: the receipt is gone
    // until the agent polls again.
    expect(await storedAnswer(id)).toMatchObject({
      answer: '{"choice":"No"}',
      text: null,
      changes: 1,
      picked_up_at: null,
    })
    expect(await poll(account, id)).toMatchObject({
      status: 'answered',
      answer: { choice: 'No' },
      text: null,
      changes: 1,
    })
  })

  it('refuses a change when the caller asks for a pending question only', async () => {
    const account = await createAccount('answer-ifpending@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'Yes' } },
      auth: { cookie },
    })
    const second = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { text: 'from a notification', if_pending: true },
      auth: { cookie },
    })
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ ok: false, error: 'Question already answered.' })
    expect(await storedAnswer(id)).toMatchObject({
      answer: '{"choice":"Yes"}',
      text: null,
      changes: 0,
    })
  })

  it('refuses an answer to an expired question', async () => {
    const account = await createAccount('answer-expired@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)
    await env.DB.prepare(`UPDATE questions SET status = 'expired' WHERE event_id = ?1`).bind(id).run()

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'Yes' } },
      auth: { cookie },
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, error: 'Question already expired.' })
  })

  it('stores both ciphertexts of an encrypted answer as given', async () => {
    const account = await createAccount('answer-enc@example.invalid')
    const cookie = await sessionFor(account.id)
    const created = await call('POST', '/api/v1/questions', {
      body: { agent: 'tester', title: 'Encrypted?', enc: true, blocks: 'Y2lwaGVydGV4dA' },
      auth: { bearer: account.key },
    })
    expect(created.status).toBe(200)
    const id = created.body.id as string

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { enc: true, answer: 'QUFB', text: 'QkJC' },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(await storedAnswer(id)).toMatchObject({ answer: 'QUFB', text: 'QkJC' })
    expect(await poll(account, id)).toMatchObject({ answer: 'QUFB', text: 'QkJC' })
  })

  // Two taps can land at once - the phone and a notification action. Each one
  // writes a whole document, so both are accepted and the stored answer is one
  // of the two bodies, never a mix of them.
  it('stores one whole body when two answers land at once', async () => {
    const account = await createAccount('answer-race@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const [a, b] = await Promise.all([
      api(req('POST', `/api/v1/questions/${id}/answer`, { body: { answer: { choice: 'Yes' } }, auth: { cookie } })),
      api(req('POST', `/api/v1/questions/${id}/answer`, { body: { answer: { choice: 'No' } }, auth: { cookie } })),
    ])
    expect([a.status, b.status]).toEqual([200, 200])

    const stored = await storedAnswer(id)
    expect(stored.status).toBe('answered')
    expect([JSON.stringify({ choice: 'Yes' }), JSON.stringify({ choice: 'No' })]).toContain(stored.answer)
    expect(stored.changes).toBe(1)
  })
})
