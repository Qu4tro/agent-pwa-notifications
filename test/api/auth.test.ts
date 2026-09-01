import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor } from '../helpers'

describe('agent bearer auth on /api/v1/events', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Build finished' },
    })
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ ok: false })
  })

  it('rejects an unknown bearer token', async () => {
    await createAccount('known@example.invalid')
    const res = await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Build finished' },
      auth: { bearer: 'ad_live_not_a_real_key' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts a valid bearer token and writes a row scoped to the account', async () => {
    const account = await createAccount('writer@example.invalid')
    const res = await call('POST', '/api/v1/events', {
      body: {
        agent: 'tester',
        title: 'Build finished',
        project: 'demo',
        blocks: [{ type: 'markdown', text: 'All green.' }],
      },
      auth: { bearer: account.key },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true })

    const row = await env.DB.prepare(
      'SELECT id, account_id, title, project, kind FROM events WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ id: string; account_id: string; title: string; project: string; kind: string }>()
    expect(row).toMatchObject({
      account_id: account.id,
      title: 'Build finished',
      project: 'demo',
      kind: 'update',
    })
  })

  it('does not let one account read another account inbox', async () => {
    const a = await createAccount('a@example.invalid')
    const b = await createAccount('b@example.invalid')
    await call('POST', '/api/v1/events', {
      body: { agent: 'tester', title: 'Only for A' },
      auth: { bearer: a.key },
    })

    const seenByB = await call('GET', '/api/v1/inbox', { auth: { bearer: b.key } })
    expect(seenByB.status).toBe(200)
    expect(JSON.stringify(seenByB.body)).not.toContain('Only for A')
  })
})

describe('session auth on the dashboard API', () => {
  it('rejects /api/v1/feed without a session cookie', async () => {
    const res = await call('GET', '/api/v1/feed')
    expect(res.status).toBe(401)
  })

  it('accepts /api/v1/feed with a session cookie', async () => {
    const account = await createAccount('reader@example.invalid')
    const res = await call('GET', '/api/v1/feed', {
      auth: { cookie: await sessionFor(account.id) },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })

  it('rejects a forged session cookie', async () => {
    const res = await call('GET', '/api/v1/feed', {
      auth: { cookie: 'ad_session=made.up' },
    })
    expect(res.status).toBe(401)
  })
})

describe('/api/v1/config', () => {
  it('reports the build version and the instant flag', async () => {
    const res = await call('GET', '/api/v1/config')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, instant: false, version: __APP_VERSION__ })
  })
})
