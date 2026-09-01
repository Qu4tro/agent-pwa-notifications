import { env } from 'cloudflare:workers'
import { handleApi } from '../src/server/router'
import { createSession } from '../src/server/auth'
import { sha256hex, ulid, now } from '../src/server/util'

export const ORIGIN = 'https://hub.test'

export interface TestAccount {
  id: string
  email: string
  key: string
}

// Insert an account row directly, with a known agent key. Mirrors what
// findOrCreateAccount does on a first OTP login, minus the email round trip.
export async function createAccount(email = 'owner@example.invalid'): Promise<TestAccount> {
  const id = ulid()
  const key = `ad_live_test_${id}`
  await env.DB.prepare(
    `INSERT INTO accounts (id, email, agent_key_hash, agent_key_prefix, created_at, last_login_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(id, email, await sha256hex(key), key.slice(0, 16), now())
    .run()
  return { id, email, key }
}

// A Cookie header value for a live session on this account.
export async function sessionFor(accountId: string): Promise<string> {
  return `ad_session=${await createSession(env, accountId)}`
}

// Call the router the way the Worker would.
export async function api(request: Request): Promise<Response> {
  const res = await handleApi(request, env)
  if (!res) throw new Error(`handleApi did not claim ${request.method} ${request.url}`)
  return res
}

type Auth = { bearer?: string; cookie?: string }

export function req(
  method: string,
  path: string,
  { body, auth = {} }: { body?: unknown; auth?: Auth } = {},
): Request {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (auth.bearer) headers.set('authorization', `Bearer ${auth.bearer}`)
  if (auth.cookie) headers.set('cookie', auth.cookie)
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function call(
  method: string,
  path: string,
  opts: { body?: unknown; auth?: Auth } = {},
): Promise<{ status: number; body: any }> {
  const res = await api(req(method, path, opts))
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // Leave the raw text for the assertion to show.
  }
  return { status: res.status, body: parsed }
}
