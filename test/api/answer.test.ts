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

async function storedAnswer(id: string): Promise<{ status: string; answer: string | null }> {
  const row = await env.DB.prepare('SELECT status, answer FROM questions WHERE event_id = ?1')
    .bind(id)
    .first<{ status: string; answer: string | null }>()
  return row!
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

describe('POST /api/v1/questions/:id/answer', () => {
  it('stores the answer and marks the event read', async () => {
    const account = await createAccount('answer-ok@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { choice: 'Yes' },
      auth: { cookie },
    })
    expect(res.status).toBe(200)
    expect(await storedAnswer(id)).toMatchObject({ status: 'answered', answer: '{"choice":"Yes"}' })
  })

  // Section 4.1, first-answer-wins. Two taps land at once (phone plus
  // notification action). Exactly one must win, and the stored answer must be
  // the winner's body - never a mix.
  it('lets exactly one of two concurrent answers win', async () => {
    const account = await createAccount('answer-race@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const [a, b] = await Promise.all([
      api(req('POST', `/api/v1/questions/${id}/answer`, { body: { choice: 'Yes' }, auth: { cookie } })),
      api(req('POST', `/api/v1/questions/${id}/answer`, { body: { choice: 'No' }, auth: { cookie } })),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])

    const winner = a.status === 200 ? 'Yes' : 'No'
    const stored = await storedAnswer(id)
    expect(stored.status).toBe('answered')
    expect(stored.answer).toBe(JSON.stringify({ choice: winner }))

    const loser = a.status === 409 ? a : b
    expect(await loser.json()).toMatchObject({ ok: false, error: 'Question already answered.' })
  })

  it('rejects a second answer to an already answered question', async () => {
    const account = await createAccount('answer-twice@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    await call('POST', `/api/v1/questions/${id}/answer`, { body: { choice: 'Yes' }, auth: { cookie } })
    const second = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { choice: 'No' },
      auth: { cookie },
    })
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ ok: false, error: 'Question already answered.' })
    expect((await storedAnswer(id)).answer).toBe(JSON.stringify({ choice: 'Yes' }))
  })

  it('rejects an answer to an expired question', async () => {
    const account = await createAccount('answer-expired@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)
    await env.DB.prepare(`UPDATE questions SET status = 'expired' WHERE event_id = ?1`).bind(id).run()

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { choice: 'Yes' },
      auth: { cookie },
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, error: 'Question already expired.' })
  })

  it('lets exactly one of two concurrent answers win on an encrypted question', async () => {
    const account = await createAccount('answer-race-enc@example.invalid')
    const cookie = await sessionFor(account.id)
    const created = await call('POST', '/api/v1/questions', {
      body: { agent: 'tester', title: 'Encrypted?', enc: true, blocks: 'Y2lwaGVydGV4dA' },
      auth: { bearer: account.key },
    })
    expect(created.status).toBe(200)
    const id = created.body.id as string

    const [a, b] = await Promise.all([
      api(req('POST', `/api/v1/questions/${id}/answer`, { body: { enc: true, answer: 'AAA' }, auth: { cookie } })),
      api(req('POST', `/api/v1/questions/${id}/answer`, { body: { enc: true, answer: 'BBB' }, auth: { cookie } })),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])

    const stored = await storedAnswer(id)
    expect(stored.status).toBe('answered')
    expect(stored.answer).toBe(a.status === 200 ? 'AAA' : 'BBB')
  })

  it('rejects an answer that matches none of the question fields', async () => {
    const account = await createAccount('answer-junk@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account)

    const res = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { nothing: 'here' },
      auth: { cookie },
    })
    expect(res.status).toBe(400)
    expect((await storedAnswer(id)).status).toBe('pending')
  })
})
