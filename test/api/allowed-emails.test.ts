import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call } from '../helpers'
import { requestLoginCode, verifyLoginCode } from '../../src/server/auth'
import { sha256hex } from '../../src/server/util'

// ALLOWED_EMAILS is an optional Worker secret: a comma-separated allow list
// that closes registration on a hub with a Resend key. Unset means open.
const LIST = 'Owner@Example.Invalid, second@example.invalid'

async function plantCode(email: string, code: string): Promise<void> {
  await env.SESSIONS.put(
    `otp:${email}`,
    JSON.stringify({ hash: await sha256hex(`${code}.${env.APP_SECRET}`), attempts: 0 }),
    { expirationTtl: 600 },
  )
}

describe('requestLoginCode with ALLOWED_EMAILS set', () => {
  it('stores nothing for an email that is not listed', async () => {
    const email = 'stranger@example.invalid'
    const ok = await requestLoginCode({ ...env, ALLOWED_EMAILS: LIST }, email, '')
    expect(ok).toBe(true) // no enumeration: the caller cannot tell
    expect(await env.SESSIONS.get(`otp:${email}`)).toBeNull()
  })

  it('stores a code for a listed email, ignoring case and spacing', async () => {
    const email = 'owner@example.invalid'
    const ok = await requestLoginCode({ ...env, ALLOWED_EMAILS: LIST }, email, '')
    expect(ok).toBe(true)
    expect(await env.SESSIONS.get(`otp:${email}`)).not.toBeNull()
  })

  it('stores a code for any email when the list is unset', async () => {
    const email = 'open-hub@example.invalid'
    expect(await requestLoginCode(env, email, '')).toBe(true)
    expect(await env.SESSIONS.get(`otp:${email}`)).not.toBeNull()
  })
})

describe('verifyLoginCode with ALLOWED_EMAILS set', () => {
  it('rejects a correct code for an email that is not listed', async () => {
    const email = 'planted@example.invalid'
    await plantCode(email, '123456')

    const result = await verifyLoginCode({ ...env, ALLOWED_EMAILS: LIST }, email, '123456')
    expect(result).toMatchObject({ ok: false, error: 'That code has expired. Request a new one.' })

    const account = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?1').bind(email).first()
    expect(account).toBeNull()
  })

  it('accepts a correct code for a listed email', async () => {
    const email = 'second@example.invalid'
    await plantCode(email, '654321')

    const result = await verifyLoginCode({ ...env, ALLOWED_EMAILS: LIST }, email, '654321')
    expect(result.ok).toBe(true)
  })
})

describe('the auth endpoints honour ALLOWED_EMAILS', () => {
  it('answers ok on request-code for an unlisted email but sends nothing', async () => {
    const email = 'router-stranger@example.invalid'
    const res = await call('POST', '/api/auth/request-code', {
      body: { email },
      env: { ALLOWED_EMAILS: LIST },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
    expect(await env.SESSIONS.get(`otp:${email}`)).toBeNull()
  })

  it('refuses verify for an unlisted email', async () => {
    const email = 'router-planted@example.invalid'
    await plantCode(email, '111222')
    const res = await call('POST', '/api/auth/verify', {
      body: { email, code: '111222' },
      env: { ALLOWED_EMAILS: LIST },
    })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ ok: false, error: 'That code has expired. Request a new one.' })
  })
})
