import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor, type TestAccount } from '../helpers'

// Note 6: one list of everything waiting on the human, across every project.
// getStats had the count and getProjects had it per project, but neither could
// say what was being asked, and getFeed stops at the 100 most recent events -
// so a question older than that would simply not be in it.

async function ask(
  account: TestAccount,
  title: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await call('POST', '/api/v1/questions', {
    body: {
      agent: 'tester',
      title,
      blocks: [{ type: 'buttons', id: 'choice', options: ['Ship', 'Hold'] }],
      ...body,
    },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

async function pending(cookie: string) {
  const res = await call('GET', '/api/v1/pending', { auth: { cookie } })
  expect(res.status).toBe(200)
  return res.body.pending as {
    key: string
    project: string
    pending: boolean
    pending_event_id: string
    pending_question: string
    pending_since: number
    pending_answers: { label: string; answer: Record<string, string> }[]
  }[]
}

describe('GET /api/v1/pending', () => {
  it('is empty when nothing is waiting', async () => {
    const account = await createAccount('pending-empty@example.invalid')
    const cookie = await sessionFor(account.id)
    await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Just an update', project: 'p' },
      auth: { bearer: account.key },
    })
    expect(await pending(cookie)).toEqual([])
  })

  it('gathers questions from every project, oldest first', async () => {
    const account = await createAccount('pending-across@example.invalid')
    const cookie = await sessionFor(account.id)
    const first = await ask(account, 'First asked', { project: 'a', task_id: 't1' })
    const second = await ask(account, 'Second asked', { project: 'b', task_id: 't2' })
    const third = await ask(account, 'Third asked', { project: '', task_id: 't3' })

    const list = await pending(cookie)
    expect(list.map((t) => t.pending_event_id)).toEqual([first, second, third])
    expect(list.map((t) => t.project)).toEqual(['a', 'b', ''])
    expect(list.map((t) => t.pending_question)).toEqual([
      'First asked',
      'Second asked',
      'Third asked',
    ])
    expect(list.every((t) => t.pending_since > 0)).toBe(true)
  })

  it('carries the options of a micro-question, so it can be answered here', async () => {
    const account = await createAccount('pending-answers@example.invalid')
    const cookie = await sessionFor(account.id)
    await ask(account, 'Ship it?', { project: 'p', task_id: 't' })

    const [item] = await pending(cookie)
    expect(item.pending_answers).toEqual([
      { label: 'Ship', answer: { choice: 'Ship' } },
      { label: 'Hold', answer: { choice: 'Hold' } },
    ])
  })

  it('drops a question the moment it is answered', async () => {
    const account = await createAccount('pending-answered@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Ship it?', { project: 'p', task_id: 't' })
    expect(await pending(cookie)).toHaveLength(1)

    const answered = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { answer: { choice: 'Ship' } },
      auth: { cookie },
    })
    expect(answered.status).toBe(200)
    expect(await pending(cookie)).toEqual([])
  })

  it('leaves an archived thread out', async () => {
    const account = await createAccount('pending-archived@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Still waiting?', { project: 'p', task_id: 't' })
    expect(await pending(cookie)).toHaveLength(1)

    // POST /archive refuses a thread with a question waiting, so this stamps
    // the row the way the retention cron does when the event ages out.
    await env.DB.prepare('UPDATE events SET archived_at = ?1 WHERE id = ?2')
      .bind(Date.now(), id)
      .run()

    expect(await pending(cookie)).toEqual([])
  })

  it('keeps two threads that share a task_id in different projects apart', async () => {
    const account = await createAccount('pending-samekey@example.invalid')
    const cookie = await sessionFor(account.id)
    await ask(account, 'From A', { project: 'a', task_id: 'shared' })
    await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'From B, no question', project: 'b', task_id: 'shared' },
      auth: { bearer: account.key },
    })

    const list = await pending(cookie)
    expect(list).toHaveLength(1)
    expect(list[0].project).toBe('a')
  })

  it('never shows one account another account questions', async () => {
    const mine = await createAccount('pending-mine@example.invalid')
    const theirs = await createAccount('pending-theirs@example.invalid')
    const cookie = await sessionFor(mine.id)
    await ask(theirs, 'Not yours', { project: 'p', task_id: 't' })
    expect(await pending(cookie)).toEqual([])
  })

  it('needs a session', async () => {
    const account = await createAccount('pending-auth@example.invalid')
    const res = await call('GET', '/api/v1/pending', { auth: { bearer: account.key } })
    expect(res.status).toBe(401)
  })
})
