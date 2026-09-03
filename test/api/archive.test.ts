import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor, type TestAccount } from '../helpers'

// Note 4: the Done heading gets a Clear that archives. Archived means out of
// the app and still in the database - every dashboard read and the agent inbox
// skip it, and no clear deletes it afterwards. The only way back to it is the
// database itself, which is what the note asked for.

async function notify(
  account: TestAccount,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await call('POST', '/api/v1/events', {
    body: { agent: 'tester', title: 'Working', project: 'p', task_id: 'thread', ...body },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

async function archive(cookie: string, keys: string[], project = 'p') {
  const res = await call('POST', '/api/v1/archive', {
    body: { project, keys },
    auth: { cookie },
  })
  expect(res.status).toBe(200)
  return res.body as { ok: boolean; archived: number }
}

async function taskKeys(cookie: string, project = 'p'): Promise<string[]> {
  const res = await call('GET', `/api/v1/tasks?project=${project}`, { auth: { cookie } })
  return (res.body.tasks as { key: string }[]).map((t) => t.key)
}

describe('POST /api/v1/archive', () => {
  it('takes a thread out of every list and leaves the rows in place', async () => {
    const account = await createAccount('archive-basic@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, { title: 'All done', kind: 'done' })

    expect(await archive(cookie, ['thread'])).toEqual({ ok: true, archived: 1 })
    expect(await taskKeys(cookie)).toEqual([])

    const projects = await call('GET', '/api/v1/projects', { auth: { cookie } })
    expect(projects.body.projects).toEqual([])

    const thread = await call('GET', '/api/v1/thread?project=p&key=thread', { auth: { cookie } })
    expect(thread.status).toBe(404)

    const feed = await call('GET', '/api/v1/feed', { auth: { cookie } })
    expect(feed.body.events).toEqual([])

    const one = await call('GET', `/api/v1/event/${id}`, { auth: { cookie } })
    expect(one.status).toBe(404)

    const inbox = await call('GET', '/api/v1/inbox', { auth: { bearer: account.key } })
    expect(inbox.body.events).toEqual([])

    // Still there, which is the whole point of archiving rather than deleting.
    const row = await env.DB.prepare('SELECT archived_at FROM events WHERE id = ?1')
      .bind(id)
      .first<{ archived_at: number | null }>()
    expect(row?.archived_at).toBeGreaterThan(0)
  })

  it('leaves an archived thread out of the unread and pending counts', async () => {
    const account = await createAccount('archive-stats@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, { title: 'Unread' })

    const before = await call('GET', '/api/v1/stats', { auth: { cookie } })
    expect(before.body.unread).toBe(1)

    await archive(cookie, ['thread'])
    const after = await call('GET', '/api/v1/stats', { auth: { cookie } })
    expect(after.body).toMatchObject({ unread: 0, pending_questions: 0 })
  })

  it('refuses a whole thread that still has a question waiting', async () => {
    const account = await createAccount('archive-pending@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, { title: 'Context' })
    const asked = await call('POST', '/api/v1/questions', {
      body: {
        agent: 'tester',
        title: 'Ship it?',
        project: 'p',
        task_id: 'thread',
        blocks: [{ type: 'buttons', id: 'choice', options: ['Ship', 'Hold'] }],
      },
      auth: { bearer: account.key },
    })
    expect(asked.status).toBe(200)

    expect(await archive(cookie, ['thread'])).toEqual({ ok: true, archived: 0 })
    expect(await taskKeys(cookie)).toEqual(['thread'])
  })

  it('archives only the keys it was given', async () => {
    const account = await createAccount('archive-scope@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, { task_id: 'one' })
    await notify(account, { task_id: 'two' })

    expect(await archive(cookie, ['one'])).toEqual({ ok: true, archived: 1 })
    expect(await taskKeys(cookie)).toEqual(['two'])
  })

  it('ignores keys from another project', async () => {
    const account = await createAccount('archive-project@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, { project: 'other', task_id: 'thread' })

    expect(await archive(cookie, ['thread'], 'p')).toEqual({ ok: true, archived: 0 })
    expect(await taskKeys(cookie, 'other')).toEqual(['thread'])
  })

  it('counts a thread once however many events it holds, and is idempotent', async () => {
    const account = await createAccount('archive-idempotent@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, { title: 'One' })
    await notify(account, { title: 'Two' })

    expect(await archive(cookie, ['thread'])).toEqual({ ok: true, archived: 1 })
    expect(await archive(cookie, ['thread'])).toEqual({ ok: true, archived: 0 })
  })

  it('takes no keys as nothing to do', async () => {
    const account = await createAccount('archive-empty@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account)

    expect(await archive(cookie, [])).toEqual({ ok: true, archived: 0 })
    expect(await taskKeys(cookie)).toEqual(['thread'])
  })

  it('needs a session, not an agent key', async () => {
    const account = await createAccount('archive-auth@example.invalid')
    const res = await call('POST', '/api/v1/archive', {
      body: { project: 'p', keys: ['thread'] },
      auth: { bearer: account.key },
    })
    expect(res.status).toBe(401)
  })

  it('survives a later clear: not even scope all deletes the archive', async () => {
    const account = await createAccount('archive-clear@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, { title: 'Kept' })
    await archive(cookie, ['thread'])

    const cleared = await call('POST', '/api/v1/clear', {
      body: { scope: 'all' },
      auth: { cookie },
    })
    expect(cleared.body).toMatchObject({ ok: true, cleared: 0 })

    const row = await env.DB.prepare('SELECT id FROM events WHERE id = ?1').bind(id).first()
    expect(row).not.toBe(null)
  })
})
