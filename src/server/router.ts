// All non-SSR routing lives here: the agent API, the dashboard API, the auth
// endpoints, the MCP endpoint and the public docs.
//
// `handleApi` returns a Response when it owns the request, and null when the
// request belongs to the TanStack Start SSR entry. Keeping it out of
// `src/worker.ts` means integration tests can import the router without
// pulling in `@tanstack/react-start/server-entry`, which only exists after a
// Vite build.

import type { Env } from './env'
import { json } from './util'
import {
  authedAccount,
  sessionAccount,
  createSession,
  sessionCookie,
  clearCookie,
  destroySession,
  bumpEpoch,
  requestLoginCode,
  verifyLoginCode,
  rotateAgentKey,
  getAccount,
  normalizeEmail,
  mintLoginLink,
  consumeLoginLink,
  linkTtlMinutes,
  safeNext,
} from './auth'
import {
  createEvent,
  updateEvent,
  createQuestion,
  getQuestion,
  getInbox,
  getFeed,
  getEvent,
  markRead,
  markAllRead,
  markUnread,
  clearEvents,
  archiveThreads,
  answerQuestion,
  subscribePush,
  unsubscribePush,
  getSettings,
  putSettings,
  getStats,
  getProjects,
  getTasks,
  getThread,
} from './api'
import { EmailCapError } from './email'
import { handleMcp } from './mcp'
import { blockSchemaDoc, openApiDoc } from './docs'

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-max-age': '86400',
}

function unauthorized(): Response {
  return json({ ok: false, error: 'Unauthorized.' }, 401)
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

export async function handleApi(
  request: Request,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // -- CORS preflight for bearer-authed agent + doc endpoints --
  if (method === 'OPTIONS' && path.startsWith('/api/v1/')) {
    return new Response(null, { status: 204, headers: CORS })
  }

  // -- Public docs (agents self-serve the contract) --
  if (path === '/api/v1/schema.json') return blockSchemaDoc()
  if (path === '/api/v1/openapi.json') return openApiDoc(url.origin)
  // The browser needs the VAPID public key to subscribe - safe to expose.
  if (path === '/api/v1/push/vapid' && method === 'GET') {
    return json({ ok: true, key: env.VAPID_PUBLIC_KEY ?? '' }, 200, CORS)
  }
  // Lets the client pick its transport (live WebSocket vs polling). Not secret.
  // no-store so a flip of INSTANT is never served from a stale edge cache.
  if (path === '/api/v1/config' && method === 'GET') {
    return json({ ok: true, instant: env.INSTANT === '1', version: __APP_VERSION__ }, 200, {
      ...CORS,
      'cache-control': 'no-store',
    })
  }

  // -- Instant-mode live feed: upgrade to this account's Hub Durable Object --
  if (path === '/ws') {
    if (env.INSTANT !== '1') return new Response('Instant mode disabled.', { status: 404 })
    const acct = await sessionAccount(request, env)
    if (!acct) return unauthorized()
    return env.HUB.get(env.HUB.idFromName(acct)).fetch(request)
  }

  // -- Email OTP auth (browser, same-origin) --
  if (path === '/api/auth/request-code' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown }
    const email = normalizeEmail(body.email)
    if (!email) return json({ ok: false, error: 'Enter a valid email address.' }, 400)
    // Always report success - never reveal whether an account exists or that a
    // send was rate-limited (both would enable enumeration/probing).
    try {
      const ip = request.headers.get('cf-connecting-ip') ?? ''
      await requestLoginCode(env, email, ip)
    } catch (e) {
      // The daily email quota is a global cap (not account-specific), so
      // telling the caller leaks nothing - and it's far better than a silent
      // "code sent" that never arrives.
      if (e instanceof EmailCapError) {
        return json(
          { ok: false, error: "We've hit today's sign-in email limit. Please try again tomorrow." },
          429,
        )
      }
      // Other send failures (bad key / unverified domain) -> log for the
      // operator, but stay generic to the caller (no enumeration).
      console.error('OTP send failed:', (e as Error).message)
    }
    return json({ ok: true })
  }
  if (path === '/api/auth/verify' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown }
    const email = normalizeEmail(body.email)
    if (!email) return json({ ok: false, error: 'Enter a valid email address.' }, 400)
    const result = await verifyLoginCode(env, email, body.code)
    if (!result.ok) return json({ ok: false, error: result.error }, 400)
    const value = await createSession(env, result.account.id)
    return json(
      {
        ok: true,
        new: result.agentKey != null,
        agent_key: result.agentKey,
        key_prefix: result.account.agent_key_prefix,
      },
      200,
      { 'set-cookie': sessionCookie(value, env) },
    )
  }
  // Agent-key login link, second half: the browser trades the token for a
  // session. Same-origin, no bearer - the token is the credential.
  if (path === '/api/auth/link' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown }
    const link = await consumeLoginLink(env, body.token)
    if (!link) return json({ ok: false, error: 'This link expired. Ask for a new one.' }, 400)
    const value = await createSession(env, link.account)
    return json({ ok: true, next: link.next }, 200, { 'set-cookie': sessionCookie(value, env) })
  }
  if (path === '/api/auth/rotate-key' && method === 'POST') {
    const acct = await sessionAccount(request, env)
    if (!acct) return unauthorized()
    const agentKey = await rotateAgentKey(env, acct)
    return json({ ok: true, agent_key: agentKey })
  }
  if (path === '/api/account' && method === 'GET') {
    const acct = await sessionAccount(request, env)
    if (!acct) return unauthorized()
    const account = await getAccount(env, acct)
    if (!account) return unauthorized()
    return json({ ok: true, email: account.email, key_prefix: account.agent_key_prefix })
  }

  // -- MCP (bearer agent key) --
  if (path === '/mcp') {
    const acct = await authedAccount(request, env)
    if (!acct) return unauthorized()
    return handleMcp(request, env, acct)
  }

  // -- Agent + dashboard API --
  if (path.startsWith('/api/v1/')) {
    // Clear the inbox - usable by YOU (session) or an AGENT (bearer) that
    // decides there's too much to keep. Default scope 'read' is safe.
    if (path === '/api/v1/clear' && method === 'POST') {
      const acct = (await authedAccount(request, env)) ?? (await sessionAccount(request, env))
      if (!acct) return withCors(unauthorized())
      const body = (await request.json().catch(() => ({}))) as { scope?: string; project?: string }
      const scope = body.scope === 'all' ? 'all' : 'read'
      return withCors(
        await clearEvents(env, acct, scope, typeof body.project === 'string' ? body.project : undefined),
      )
    }

    const eventUpdate = path.match(/^\/api\/v1\/events\/([^/]+)$/)
    const agentRoute =
      (path === '/api/v1/events' && method === 'POST') ||
      (eventUpdate && method === 'POST') ||
      (path === '/api/v1/questions' && method === 'POST') ||
      (path === '/api/v1/login-link' && method === 'POST') ||
      (path === '/api/v1/inbox' && method === 'GET') ||
      (/^\/api\/v1\/questions\/[^/]+$/.test(path) && method === 'GET')

    if (agentRoute) {
      const acct = await authedAccount(request, env)
      if (!acct) return withCors(unauthorized())
      // Agent-key login link, first half: mint a one-time URL the human can
      // open to sign in without an email round trip.
      if (path === '/api/v1/login-link') {
        const body = (await request.json().catch(() => ({}))) as {
          next?: unknown
          ttl_minutes?: unknown
        }
        const minted = await mintLoginLink(
          env,
          acct,
          safeNext(body.next),
          linkTtlMinutes(body.ttl_minutes),
        )
        if (!minted.ok) return withCors(json({ ok: false, error: minted.error }, 429))
        return withCors(
          json({
            ok: true,
            url: `${url.origin}/login?t=${minted.token}`,
            expires_at: minted.expiresAt,
          }),
        )
      }
      if (path === '/api/v1/events') return withCors(await createEvent(request, env, acct))
      if (eventUpdate) return withCors(await updateEvent(eventUpdate[1], request, env, acct))
      if (path === '/api/v1/questions') return withCors(await createQuestion(request, env, acct))
      if (path === '/api/v1/inbox') return withCors(await getInbox(url, env, acct))
      const qid = path.split('/').pop() as string
      return withCors(await getQuestion(qid, env, acct))
    }

    // -- Dashboard API (session cookie) --
    const acct = await sessionAccount(request, env)
    if (!acct) return unauthorized()

    if (path === '/api/v1/feed' && method === 'GET') return getFeed(url, env, acct)
    if (path === '/api/v1/projects' && method === 'GET') return getProjects(env, acct)
    if (path === '/api/v1/tasks' && method === 'GET')
      return getTasks(url.searchParams.get('project') ?? '', env, acct)
    if (path === '/api/v1/thread' && method === 'GET')
      return getThread(url.searchParams.get('project') ?? '', url.searchParams.get('key') ?? '', env, acct)
    if (path === '/api/v1/stats' && method === 'GET') return getStats(env, acct)
    if (path === '/api/v1/settings' && method === 'GET') return getSettings(env, acct)
    if (path === '/api/v1/settings' && method === 'POST') return putSettings(request, env, acct)
    if (path === '/api/v1/read-all' && method === 'POST') return markAllRead(env, acct)
    // Session only. Archiving is a human action - no agent-facing equivalent.
    if (path === '/api/v1/archive' && method === 'POST') return archiveThreads(request, env, acct)
    if (path === '/api/v1/push/subscribe' && method === 'POST') return subscribePush(request, env, acct)
    if (path === '/api/v1/push/unsubscribe' && method === 'POST') return unsubscribePush(request, env, acct)

    const eventMatch = path.match(/^\/api\/v1\/event\/([^/]+)$/)
    if (eventMatch && method === 'GET') return getEvent(eventMatch[1], env, acct)

    const readMatch = path.match(/^\/api\/v1\/event\/([^/]+)\/read$/)
    if (readMatch && method === 'POST') return markRead(readMatch[1], env, acct)

    const unreadMatch = path.match(/^\/api\/v1\/event\/([^/]+)\/unread$/)
    if (unreadMatch && method === 'POST') return markUnread(unreadMatch[1], env, acct)

    const answerMatch = path.match(/^\/api\/v1\/questions\/([^/]+)\/answer$/)
    if (answerMatch && method === 'POST') return answerQuestion(answerMatch[1], request, env, acct)

    return json({ ok: false, error: 'Not found.' }, 404)
  }

  // -- Logout (this device) and logout-everywhere --
  if (path === '/api/logout' && method === 'POST') {
    await destroySession(request, env)
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
  }
  if (path === '/api/logout-all' && method === 'POST') {
    const acct = await sessionAccount(request, env)
    if (!acct) return unauthorized()
    await bumpEpoch(env, acct)
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
  }

  // Not ours: the caller falls through to the TanStack Start SSR entry.
  return null
}
