import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor, type TestAccount } from '../helpers'

const twoOptions = [{ type: 'buttons', id: 'choice', options: ['Yes', 'No'] }]

async function ask(account: TestAccount, title: string, project?: string): Promise<string> {
  const res = await call('POST', '/api/v1/questions', {
    body: { agent: 'tester', title, project, blocks: twoOptions },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

async function post(account: TestAccount, title: string, project?: string): Promise<string> {
  const res = await call('POST', '/api/v1/events', {
    body: { agent: 'tester', title, project, blocks: [{ type: 'markdown', text: title }] },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

async function eventIds(accountId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM events WHERE account_id = ?1 ORDER BY created_at',
  )
    .bind(accountId)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

async function questionIds(accountId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT q.event_id AS id FROM questions q
     JOIN events e ON e.id = q.event_id WHERE e.account_id = ?1`,
  )
    .bind(accountId)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

describe('POST /api/v1/clear with scope read', () => {
  // Section 4.1, case 1. The brief suspected a lone answered question survived
  // "clear read". It does not: answerQuestion stamps read_at, so the row is
  // already read by the time clear runs. Kept green as a regression guard.
  it('deletes an answered question that was never explicitly marked read', async () => {
    const account = await createAccount('case1@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Ship it?')

    const answered = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { choice: 'Yes' },
      auth: { cookie },
    })
    expect(answered.status).toBe(200)

    const cleared = await call('POST', '/api/v1/clear', { body: { scope: 'read' }, auth: { cookie } })
    expect(cleared.status).toBe(200)
    expect(cleared.body).toMatchObject({ ok: true, cleared: 1 })

    expect(await eventIds(account.id)).toEqual([])
    expect(await questionIds(account.id)).toEqual([])
  })

  // Section 4.1, case 2.
  it('keeps an unread update while removing the answered question in the same thread', async () => {
    const account = await createAccount('case2@example.invalid')
    const cookie = await sessionFor(account.id)
    const questionId = await ask(account, 'Ship it?')
    const updateId = await post(account, 'Still building')

    await call('POST', `/api/v1/questions/${questionId}/answer`, {
      body: { choice: 'Yes' },
      auth: { cookie },
    })

    const cleared = await call('POST', '/api/v1/clear', { body: { scope: 'read' }, auth: { cookie } })
    expect(cleared.body).toMatchObject({ ok: true, cleared: 1 })

    expect(await eventIds(account.id)).toEqual([updateId])
    expect(await questionIds(account.id)).toEqual([])
  })

  // Section 4.1, case 3.
  it('only touches the named project when a project filter is given', async () => {
    const account = await createAccount('case3@example.invalid')
    const cookie = await sessionFor(account.id)
    const alphaId = await ask(account, 'Alpha ready?', 'alpha')
    const betaId = await ask(account, 'Beta ready?', 'beta')

    for (const id of [alphaId, betaId]) {
      await call('POST', `/api/v1/questions/${id}/answer`, {
        body: { choice: 'Yes' },
        auth: { cookie },
      })
    }

    const cleared = await call('POST', '/api/v1/clear', {
      body: { scope: 'read', project: 'alpha' },
      auth: { cookie },
    })
    expect(cleared.body).toMatchObject({ ok: true, cleared: 1 })

    expect(await eventIds(account.id)).toEqual([betaId])
    expect(await questionIds(account.id)).toEqual([betaId])
  })

  it('leaves an unread event alone', async () => {
    const account = await createAccount('unread@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await post(account, 'Never opened')

    const cleared = await call('POST', '/api/v1/clear', { body: { scope: 'read' }, auth: { cookie } })
    expect(cleared.body).toMatchObject({ ok: true, cleared: 0 })
    expect(await eventIds(account.id)).toEqual([id])
  })

  it('never reaches into another account', async () => {
    const a = await createAccount('owner-a@example.invalid')
    const b = await createAccount('owner-b@example.invalid')
    const cookieA = await sessionFor(a.id)
    const cookieB = await sessionFor(b.id)

    const idA = await post(a, 'A read me')
    const idB = await post(b, 'B read me')
    await call('POST', `/api/v1/event/${idA}/read`, { auth: { cookie: cookieA } })
    await call('POST', `/api/v1/event/${idB}/read`, { auth: { cookie: cookieB } })

    await call('POST', '/api/v1/clear', { body: { scope: 'read' }, auth: { cookie: cookieA } })

    expect(await eventIds(a.id)).toEqual([])
    expect(await eventIds(b.id)).toEqual([idB])
  })
})

describe('POST /api/v1/clear with scope all', () => {
  it('removes read and unread events alike', async () => {
    const account = await createAccount('all@example.invalid')
    const cookie = await sessionFor(account.id)
    await post(account, 'Unread one')
    await ask(account, 'Pending question?')

    const cleared = await call('POST', '/api/v1/clear', { body: { scope: 'all' }, auth: { cookie } })
    expect(cleared.body).toMatchObject({ ok: true, cleared: 2 })
    expect(await eventIds(account.id)).toEqual([])
    expect(await questionIds(account.id)).toEqual([])
  })

  it('is reachable with the agent bearer key too', async () => {
    const account = await createAccount('agent-clear@example.invalid')
    await post(account, 'Noise')

    const cleared = await call('POST', '/api/v1/clear', {
      body: { scope: 'all' },
      auth: { bearer: account.key },
    })
    expect(cleared.status).toBe(200)
    expect(await eventIds(account.id)).toEqual([])
  })
})
