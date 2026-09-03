import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../lib/api'
import { APP_NAME } from '../lib/brand'
import { clearPersistedCache } from '../lib/query'
import { Button, Snippet, fieldClass } from '../lib/ui'

// `next` is where the app sends a visitor whose session ran out, and `t` is a
// one-time login-link token. Declaring them here is what lets a route guard
// build the redirect.
export const Route = createFileRoute('/login')({
  component: LoginPage,
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { next?: string; t?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
    t: typeof search.t === 'string' ? search.t : undefined,
  }),
})

// Only a same-origin path is ever used as a landing target, so neither a login
// link nor a crafted `?next=` can bounce the browser to another site.
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

function searchParams(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
}

// Two ways in. A one-time login link (`/login?t=...`, minted by an agent with
// `agent-notify-pwa open`) trades its token for a session straight away.
// Otherwise: email, then a one-time code, then (for a brand-new account) the
// agent key shown once, with the connect step. On success we hard-navigate so
// the freshly-set session cookie is picked up. `?next=` decides where we land,
// which is how a notification answered on an expired session comes back to its
// own thread.
function LoginPage() {
  const [stage, setStage] = useState<'email' | 'code' | 'key'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [agentKey, setAgentKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkPending, setLinkPending] = useState(() => searchParams().has('t'))

  function land(next?: string | null) {
    window.location.href = safeNext(next ?? null) ?? safeNext(searchParams().get('next')) ?? '/'
  }

  // A fresh sign-in must not inherit the cached lists of whoever used this
  // device last, so the persisted cache goes before the new session lands.
  function landAsNewSession(next?: string | null) {
    clearPersistedCache()
    land(next)
  }

  useEffect(() => {
    const token = searchParams().get('t')
    if (token) {
      api
        .consumeLink(token)
        .then((res) => {
          if (res.ok) {
            landAsNewSession(res.next)
            return
          }
          setError('This link expired. Ask for a new one.')
          setLinkPending(false)
        })
        .catch(() => {
          setError('This link expired. Ask for a new one.')
          setLinkPending(false)
        })
      return
    }
    // Already signed in? Skip straight to the projects.
    api.account().then(() => {
      land()
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.requestCode(email.trim())
      if (!res.ok) setError(res.error ?? 'Something went wrong.')
      else setStage('code')
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.verifyCode(email.trim(), code.trim())
      if (!res.ok) {
        setError(res.error ?? 'Incorrect code.')
      } else if (res.new && res.agent_key) {
        setAgentKey(res.agent_key)
        setStage('key')
      } else {
        landAsNewSession() // returning user, session set, load the app
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-[22rem]">
        <h1 className="mb-4 text-center font-semibold">{APP_NAME}</h1>

        {linkPending && <p className="text-center text-[14px] text-muted">Signing you in...</p>}

        {!linkPending && stage === 'email' && (
          <form onSubmit={sendCode} className="flex flex-col gap-2">
            <p className="text-[13px] text-muted">Your email, then a one-time code.</p>
            <input
              type="email"
              autoFocus
              required
              placeholder="you@example.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className={`${fieldClass} min-h-9`}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Sending' : 'Send code'}
            </Button>
          </form>
        )}

        {stage === 'code' && (
          <form onSubmit={verify} className="flex flex-col gap-2">
            <p className="text-[13px] text-muted">
              A 6-digit code went to <span className="text-text">{email}</span>.
            </p>
            <input
              inputMode="numeric"
              autoFocus
              required
              placeholder="123456"
              value={code}
              onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${fieldClass} min-h-9 text-center text-[18px] tracking-[0.3em]`}
            />
            <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying' : 'Verify'}
            </Button>
            <Button
              className="border-transparent text-muted"
              onClick={() => {
                setStage('email')
                setCode('')
                setError(null)
              }}
            >
              Use a different email
            </Button>
          </form>
        )}

        {stage === 'key' && agentKey && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted">
              Your agent key. Copy it now, it will not be shown again.
            </p>
            <Snippet text={agentKey} />
            <p className="mt-2 text-[13px] text-muted">
              Install the skill, then paste the key when the agent asks for it:
            </p>
            <Snippet text="npx skills add Qu4tro/agent-pwa-notifications" />
            <Button variant="primary" className="mt-2" onClick={() => landAsNewSession()}>
              Continue
            </Button>
          </div>
        )}

        {error && <p className="mt-3 text-center text-[13px] text-kind-error">{error}</p>}
      </div>
    </div>
  )
}
