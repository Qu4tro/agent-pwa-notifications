import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { api, call, createAccount, req, sessionFor } from '../helpers'
import { runCron } from '../../src/server/cron'

const DAY = 86_400_000

async function loginLinkCookie(bearer: string, overrides?: Record<string, string>) {
  const minted = await call('POST', '/api/v1/login-link', { body: {}, auth: { bearer }, env: overrides })
  const token = new URL(minted.body.url).searchParams.get('t')
  const res = await api(req('POST', '/api/auth/link', { body: { token } }), overrides)
  return res.headers.get('set-cookie') as string
}

// Section 4.1: events keep for 90 days and sessions for 365 by default, and
// wrangler.jsonc carries both as vars so an operator can shorten them.
describe('retention defaults', () => {
  it('stamps a new event to expire 90 days out', async () => {
    const account = await createAccount('retention@example.invalid')
    const before = Date.now()
    const res = await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Keep me' },
      auth: { bearer: account.key },
    })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT expires_at FROM events WHERE id = ?1')
      .bind(res.body.id)
      .first<{ expires_at: number }>()
    expect(row!.expires_at).toBeGreaterThanOrEqual(before + 90 * DAY)
    expect(row!.expires_at).toBeLessThanOrEqual(Date.now() + 90 * DAY)
  })

  it('honours EVENT_RETENTION_DAYS when it is set', async () => {
    const account = await createAccount('retention-var@example.invalid')
    const before = Date.now()
    const res = await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Short lived' },
      auth: { bearer: account.key },
      env: { EVENT_RETENTION_DAYS: '7' },
    })

    const row = await env.DB.prepare('SELECT expires_at FROM events WHERE id = ?1')
      .bind(res.body.id)
      .first<{ expires_at: number }>()
    expect(row!.expires_at).toBeGreaterThanOrEqual(before + 7 * DAY)
    expect(row!.expires_at).toBeLessThanOrEqual(Date.now() + 7 * DAY)
  })

  it('sets a session cookie that lives for 365 days', async () => {
    const account = await createAccount('session-ttl@example.invalid')
    const cookie = await loginLinkCookie(account.key)
    expect(cookie).toContain(`Max-Age=${365 * 86_400}`)
  })

  it('honours SESSION_TTL_DAYS when it is set', async () => {
    const account = await createAccount('session-ttl-var@example.invalid')
    const cookie = await loginLinkCookie(account.key, { SESSION_TTL_DAYS: '30' })
    expect(cookie).toContain(`Max-Age=${30 * 86_400}`)
  })
})

// Note 4 moved the retention cron off DELETE. An event past its TTL leaves the
// app, but the row stays: after this, nothing in the app deletes on its own.
describe('the retention cron', () => {
  it('archives an expired event instead of deleting it', async () => {
    const account = await createAccount('retention-cron@example.invalid')
    const cookie = await sessionFor(account.id)
    const res = await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Old news', project: 'p', task_id: 'thread' },
      auth: { bearer: account.key },
    })
    await env.DB.prepare('UPDATE events SET expires_at = ?1 WHERE id = ?2')
      .bind(Date.now() - 1000, res.body.id)
      .run()

    await runCron(env)

    const row = await env.DB.prepare('SELECT archived_at FROM events WHERE id = ?1')
      .bind(res.body.id)
      .first<{ archived_at: number | null }>()
    expect(row, 'the row is still there').not.toBe(null)
    expect(row!.archived_at).toBeGreaterThan(0)

    const tasks = await call('GET', '/api/v1/tasks?project=p', { auth: { cookie } })
    expect(tasks.body.tasks).toEqual([])
  })

  it('leaves an event that has not expired alone', async () => {
    const account = await createAccount('retention-cron-keep@example.invalid')
    const cookie = await sessionFor(account.id)
    await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Fresh', project: 'k', task_id: 'thread' },
      auth: { bearer: account.key },
    })

    await runCron(env)

    const tasks = await call('GET', '/api/v1/tasks?project=k', { auth: { cookie } })
    expect(tasks.body.tasks).toHaveLength(1)
  })
})
