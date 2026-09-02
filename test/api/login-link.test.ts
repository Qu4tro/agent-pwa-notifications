import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { api, call, createAccount, ORIGIN, req } from '../helpers'
import { sha256hex } from '../../src/server/util'

function tokenOf(url: string): string {
  return new URL(url).searchParams.get('t') as string
}

async function mint(bearer: string, body?: unknown) {
  return call('POST', '/api/v1/login-link', { body: body ?? {}, auth: { bearer } })
}

describe('POST /api/v1/login-link', () => {
  it('mints a link for the bearer account', async () => {
    const account = await createAccount('link-mint@example.invalid')
    const before = Date.now()
    const res = await mint(account.key)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(String(res.body.url).startsWith(`${ORIGIN}/login?t=`)).toBe(true)
    expect(res.body.expires_at).toBeGreaterThan(before + 14 * 60_000)
    expect(res.body.expires_at).toBeLessThanOrEqual(Date.now() + 15 * 60_000)

    const stored = await env.SESSIONS.get(`link:${await sha256hex(tokenOf(res.body.url))}`)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored as string)).toMatchObject({ account: account.id, next: '/' })
  })

  it('rejects a request with no bearer token', async () => {
    const res = await call('POST', '/api/v1/login-link', { body: {} })
    expect(res.status).toBe(401)
  })

  it('rejects an unknown bearer token', async () => {
    await createAccount('link-known@example.invalid')
    const res = await mint('ad_live_not_a_real_key')
    expect(res.status).toBe(401)
  })

  it('clamps ttl_minutes to the 1 to 60 range', async () => {
    const account = await createAccount('link-ttl@example.invalid')

    const long = await mint(account.key, { ttl_minutes: 600 })
    expect(long.body.expires_at).toBeLessThanOrEqual(Date.now() + 60 * 60_000)
    expect(long.body.expires_at).toBeGreaterThan(Date.now() + 59 * 60_000)

    const short = await mint(account.key, { ttl_minutes: 0 })
    expect(short.body.expires_at).toBeLessThanOrEqual(Date.now() + 60_000)
    expect(short.body.expires_at).toBeGreaterThan(Date.now())
  })

  it('keeps a relative next path and drops an absolute one', async () => {
    const account = await createAccount('link-next@example.invalid')

    const ok = await mint(account.key, { next: '/event/01ABC' })
    const okStored = JSON.parse(
      (await env.SESSIONS.get(`link:${await sha256hex(tokenOf(ok.body.url))}`)) as string,
    )
    expect(okStored.next).toBe('/event/01ABC')

    const bad = await mint(account.key, { next: 'https://evil.example/steal' })
    const badStored = JSON.parse(
      (await env.SESSIONS.get(`link:${await sha256hex(tokenOf(bad.body.url))}`)) as string,
    )
    expect(badStored.next).toBe('/')

    const protocolRelative = await mint(account.key, { next: '//evil.example/steal' })
    const prStored = JSON.parse(
      (await env.SESSIONS.get(`link:${await sha256hex(tokenOf(protocolRelative.body.url))}`)) as string,
    )
    expect(prStored.next).toBe('/')
  })

  it('rate limits to 10 links an hour per account', async () => {
    const account = await createAccount('link-rate@example.invalid')
    for (let i = 0; i < 10; i++) expect((await mint(account.key)).status).toBe(200)
    const over = await mint(account.key)
    expect(over.status).toBe(429)
    expect(over.body).toMatchObject({ ok: false })
  })
})

describe('POST /api/auth/link', () => {
  it('consumes a token once and returns a working session', async () => {
    const account = await createAccount('link-consume@example.invalid')
    const minted = await mint(account.key, { next: '/settings' })
    const token = tokenOf(minted.body.url)

    const res = await api(req('POST', '/api/auth/link', { body: { token } }))
    expect(res.status).toBe(200)
    expect(await res.clone().json()).toMatchObject({ ok: true, next: '/settings' })

    const setCookie = res.headers.get('set-cookie') as string
    expect(setCookie).toContain('ad_session=')
    const cookie = setCookie.split(';')[0]

    const me = await call('GET', '/api/account', { auth: { cookie } })
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ ok: true, email: 'link-consume@example.invalid' })
  })

  it('fails on the second use of the same token', async () => {
    const account = await createAccount('link-single-use@example.invalid')
    const token = tokenOf((await mint(account.key)).body.url)

    expect((await call('POST', '/api/auth/link', { body: { token } })).status).toBe(200)
    const second = await call('POST', '/api/auth/link', { body: { token } })
    expect(second.status).toBe(400)
    expect(second.body).toMatchObject({ ok: false, error: 'This link expired. Ask for a new one.' })
  })

  it('fails on an expired token', async () => {
    const account = await createAccount('link-expired@example.invalid')
    const token = tokenOf((await mint(account.key)).body.url)
    const key = `link:${await sha256hex(token)}`
    await env.SESSIONS.put(key, JSON.stringify({ account: account.id, next: '/', exp: Date.now() - 1000 }))

    const res = await call('POST', '/api/auth/link', { body: { token } })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ ok: false })
    expect(await env.SESSIONS.get(key)).toBeNull()
  })

  it('fails on an unknown token', async () => {
    const res = await call('POST', '/api/auth/link', { body: { token: 'not-a-token' } })
    expect(res.status).toBe(400)
  })

  it('fails when no token is given', async () => {
    const res = await call('POST', '/api/auth/link', { body: {} })
    expect(res.status).toBe(400)
  })
})
