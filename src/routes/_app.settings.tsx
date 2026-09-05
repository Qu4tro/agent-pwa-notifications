import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff } from 'lucide-react'
import { api } from '../lib/api'
import { APP_NAME, REPO_URL, UPSTREAM_URL } from '../lib/brand'
import { Container } from '../lib/shell'
import { SettingsSkeleton } from '../lib/skeleton'
import {
  accountQuery,
  ensure,
  queryKeys,
  settingsQuery,
  useClear,
  usePutSettings,
  useSubscribePush,
  useUnsubscribePush,
} from '../lib/queries'
import { clearPersistedCache } from '../lib/query'
import { getEncKey, setEncKey, clearEncKey, generateEncKey } from '../lib/e2e'
import { DEFAULT_THEME, THEMES, getTheme, setTheme, type Theme } from '../lib/theme'
import { Button, ConfirmPanel, InlineError, Snippet, fieldClass, sectionHeadingClass } from '../lib/ui'

export const Route = createFileRoute('/_app/settings')({
  ssr: false,
  loader: ({ context }) =>
    context.signedIn
      ? ensure<{ start: number; end: number } | null>(context.queryClient, settingsQuery())
      : undefined,
  pendingComponent: SettingsSkeleton,
  component: SettingsPage,
})

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// One column, one heading per topic, no cards. The order is the order a new
// hub is set up in: turn on notifications, quieten them, get the key, connect
// an agent, then what is only taste, then the housekeeping.
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 px-4">
      <h2 className={`mb-3 border-b border-edge pb-1.5 ${sectionHeadingClass}`}>{title}</h2>
      {children}
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[15px] text-muted">{children}</p>
}

function SettingsPage() {
  const { data: quiet, isError, isFetched, refetch } = useQuery(settingsQuery())
  const putSettings = usePutSettings()
  const subscribe = useSubscribePush()
  const unsubscribe = useUnsubscribePush()
  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)


  // Whether this device has a push subscription is a browser fact, not a
  // server one, so it stays out of the query cache.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    ;(async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null)
      const sub = await reg?.pushManager.getSubscription()
      setPushOn(!!sub)
    })()
  }, [])

  async function enablePush() {
    setPushBusy(true)
    setPushMsg(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushMsg(
          'This browser does not support push. On iOS, add this app to your Home Screen first.',
        )
        setPushBusy(false)
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setPushMsg('Notification permission was denied.')
        setPushBusy(false)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const { key } = await api.vapid()
      if (!key) {
        setPushMsg('Server is missing VAPID keys. Re-run setup.')
        setPushBusy(false)
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
      await subscribe.mutateAsync(sub.toJSON())
      setPushOn(true)
      setPushMsg('Notifications enabled on this device.')
    } catch (e) {
      setPushMsg('Could not enable push: ' + (e as Error).message)
    }
    setPushBusy(false)
  }

  async function disablePush() {
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await unsubscribe.mutateAsync(sub.endpoint)
        await sub.unsubscribe()
      }
      setPushOn(false)
      setPushMsg('Notifications disabled on this device.')
    } catch {
      /* ignore */
    }
    setPushBusy(false)
  }

  if (!isFetched && quiet === undefined) return <SettingsSkeleton />

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <Container>
      <h1 className="mb-5 px-4 text-[22px] font-semibold">Settings</h1>

      {isError && quiet === undefined ? (
        <div className="mb-4">
          <InlineError message="Could not load your settings." onRetry={() => refetch()} />
        </div>
      ) : null}

      <Group title="Notifications">
        <Note>
          Get a push on this device when an agent needs you or flags something important.
        </Note>
        {pushOn ? (
          <Button onClick={disablePush} disabled={pushBusy}>
            <BellOff size={16} aria-hidden /> Disable on this device
          </Button>
        ) : (
          <Button variant="primary" onClick={enablePush} disabled={pushBusy}>
            <Bell size={16} aria-hidden /> Enable notifications
          </Button>
        )}
        {pushMsg ? <p className="mt-2 text-[15px] text-muted">{pushMsg}</p> : null}
      </Group>

      <Group title="Quiet hours">
        <Note>
          Silence non-urgent pings during these hours. Urgent (priority 2) always rings through.
        </Note>
        <label className="mb-2 flex min-h-11 items-center gap-2 text-[16px]">
          <input
            type="checkbox"
            checked={!!quiet}
            onChange={(e) =>
              putSettings.mutate(e.target.checked ? { start: 22 * 60, end: 7 * 60 } : null)
            }
          />
          <span>Enable quiet hours</span>
        </label>
        {quiet && (
          <div className="flex items-center gap-4">
            <TimeField
              label="From"
              minutes={quiet.start}
              onChange={(m) => putSettings.mutate({ ...quiet, start: m })}
            />
            <TimeField
              label="To"
              minutes={quiet.end}
              onChange={(m) => putSettings.mutate({ ...quiet, end: m })}
            />
          </div>
        )}
      </Group>

      <Group title="Agent key">
        <AgentKeySection />
      </Group>

      <Group title="Connect an agent">
        <Note>Install the skill, then paste your key when the agent asks for it:</Note>
        <Snippet text="npx skills add Qu4tro/agent-pwa-notifications" />
        <p className="mt-3 mb-2 text-[15px] text-muted">
          Any agent can also push an update with one curl:
        </p>
        <Snippet
          text={`curl -X POST ${origin}/api/v1/events \\
  -H "Authorization: Bearer YOUR_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agent":"claude","title":"Build finished","priority":1}'`}
        />
        <p className="mt-2 text-[15px]">
          <a href="/api/v1/schema.json" target="_blank" rel="noreferrer">
            Block schema
          </a>
          {' | '}
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
        </p>
      </Group>

      <Group title="Encryption">
        <EncryptionSection />
      </Group>

      <Group title="Appearance">
        <ThemeSection />
      </Group>

      <Group title="Clear inbox">
        <Note>
          Tidy up or start fresh. Agents can also clear things themselves when it gets cluttered.
        </Note>
        <ClearButtons />
      </Group>

      <Group title="Session">
        <SessionButtons />
      </Group>

      <Group title="About">
        <p className="text-[15px] text-muted">
          {APP_NAME} {__APP_VERSION__}
        </p>
        <p className="mt-1 text-[15px] text-muted">
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source
          </a>
          . A fork of{' '}
          <a href={UPSTREAM_URL} target="_blank" rel="noreferrer">
            Prajeevan/agent-dash
          </a>
          , MIT licensed.
        </p>
      </Group>
    </Container>
  )
}

function TimeField({
  label,
  minutes,
  onChange,
}: {
  label: string
  minutes: number
  onChange: (m: number) => void
}) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return (
    <label className="flex flex-col gap-1 text-[15px] text-muted">
      {label}
      <input
        type="time"
        value={`${hh}:${mm}`}
        onChange={(e) => {
          const [h, m] = e.target.value.split(':').map(Number)
          onChange(h * 60 + m)
        }}
        className={`${fieldClass} min-h-11 w-auto`}
      />
    </label>
  )
}

// Logging out drops every cached list, including the persisted copy, so the
// next visitor on this device starts from nothing.
function SessionButtons() {
  const client = useQueryClient()

  async function end(everywhere: boolean) {
    await (everywhere ? api.logoutAll() : api.logout()).catch(() => {})
    client.clear()
    clearPersistedCache()
    window.location.href = '/login'
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => end(false)}>Log out (this device)</Button>
      <Button variant="danger" onClick={() => end(true)}>
        Log out everywhere
      </Button>
    </div>
  )
}

function EncryptionSection() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setSaved(getEncKey())
  }, [])

  function save(k: string) {
    const v = k.trim()
    if (!v) return
    setEncKey(v)
    setSaved(v)
    setKey('')
    setMsg('Key saved on this device. Give the SAME key to your agent (CLI: --enc-key).')
  }

  return (
    <div>
      <Note>
        With a key set, message content is decrypted on this device and the server only ever
        stores ciphertext it cannot read. The key never leaves this device. Give the same key to
        your agent so it can encrypt. Quick answers from a notification are skipped for encrypted
        questions by design.
      </Note>
      {saved ? (
        <div>
          <p className="mb-1 text-[15px] text-kind-done">Encryption is on for this device.</p>
          <pre className="overflow-x-auto rounded-ui bg-surface p-3 text-[13px] text-muted">
            <code>{saved}</code>
          </pre>
          <Button
            variant="danger"
            className="mt-2"
            onClick={() => {
              clearEncKey()
              setSaved(null)
              setMsg('Encryption turned off on this device.')
            }}
          >
            Turn off
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your encryption key"
            className={`${fieldClass} min-h-11 font-mono`}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => save(key)}>
              Save key
            </Button>
            <Button onClick={() => save(generateEncKey())}>Generate a new key</Button>
          </div>
        </div>
      )}
      {msg ? <p className="mt-2 text-[15px] text-muted">{msg}</p> : null}
    </div>
  )
}

// Which theme this device is drawn in. A device thing, like the encryption
// key: it is stored in this browser and nothing about it reaches the hub, so
// a phone can be grey and a laptop dark on the same account. Read after mount
// rather than on the first render, because the server has no localStorage to
// read it from - the document has already applied it by then, from the inline
// script in __root.tsx, so nothing about the page changes when this lands.
//
// The choice takes effect on the tap. There is nothing to save: it is one
// attribute on <html>, and every colour in the app follows it.
function ThemeSection() {
  const [chosen, setChosen] = useState(DEFAULT_THEME)
  useEffect(() => setChosen(getTheme()), [])

  return (
    <div>
      <Note>How the app is drawn. The choice is this device's and stays on it.</Note>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Theme</legend>
        {THEMES.map((t) => (
          <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
            <input
              type="radio"
              name="theme"
              value={t.id}
              checked={chosen === t.id}
              onChange={() => {
                setTheme(t.id)
                setChosen(t.id)
              }}
            />
            <ThemeSwatch theme={t} />
            <span className="min-w-0">
              <span className="block text-[16px]">{t.name}</span>
              <span className="block text-[15px] text-muted">{t.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}

// What a theme looks like, in that theme's own four colours: the page, the
// strip along the top of it, a line of text on it and the accent under that.
// Painted rather than described, so the choice can be made without making it,
// and small enough that it is a mark beside a name and not a screenshot.
function ThemeSwatch({ theme }: { theme: Theme }) {
  const s = theme.swatch
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 flex-col overflow-hidden rounded-ui border"
      style={{ borderColor: s.text, background: s.page }}
    >
      <span className="block h-3 w-full" style={{ background: s.bar }} />
      <span className="mt-2 ml-1.5 block h-1 w-6" style={{ background: s.text }} />
      <span className="mt-1 ml-1.5 block h-1 w-3.5" style={{ background: s.accent }} />
    </span>
  )
}

function ClearButtons() {
  const clear = useClear()
  const [confirming, setConfirming] = useState<null | 'read' | 'all'>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(scope: 'read' | 'all') {
    setConfirming(null)
    const res = await clear.mutateAsync({ scope }).catch(() => null)
    setMsg(res ? `Cleared ${res.cleared} item${res.cleared === 1 ? '' : 's'}.` : 'Could not clear.')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setConfirming('read')}>Clear read and answered</Button>
        <Button variant="danger" onClick={() => setConfirming('all')}>
          Clear everything
        </Button>
      </div>
      {confirming ? (
        <ConfirmPanel
          className="mt-3"
          actions={
            <>
              <Button variant="danger" onClick={() => run(confirming)}>
                Yes, clear
              </Button>
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
            </>
          }
        >
          {confirming === 'all'
            ? 'Delete every message, including unanswered questions? This cannot be undone.'
            : 'Delete everything you have already read or answered?'}
        </ConfirmPanel>
      ) : null}
      {msg ? <p className="mt-2 text-[15px] text-muted">{msg}</p> : null}
    </div>
  )
}

// Shows the account's key prefix (the raw key is never stored, so it cannot be
// re-shown) and lets the user rotate to a fresh key, revealed once.
function AgentKeySection() {
  const client = useQueryClient()
  const { data: account } = useQuery(accountQuery())
  const [rotated, setRotated] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const prefix = rotated ? rotated.slice(0, 16) : (account?.key_prefix ?? null)

  async function rotate() {
    setConfirming(false)
    setBusy(true)
    try {
      const res = await api.rotateKey()
      setRotated(res.agent_key)
      await client.invalidateQueries({ queryKey: queryKeys.account() })
    } catch {
      /* ignore */
    }
    setBusy(false)
  }

  return (
    <div>
      <Note>
        {account?.email ? (
          <>
            Signed in as <span className="text-text">{account.email}</span>.{' '}
          </>
        ) : null}
        Agents authenticate with this key. It is stored only as a hash, so it cannot be shown
        again. Rotate it if you lose it.
      </Note>

      {rotated ? (
        <div className="mb-2">
          <p className="mb-1 text-[15px] text-kind-done">
            New key. Copy it now, it will not be shown again:
          </p>
          <Snippet text={rotated} />
        </div>
      ) : (
        <p className="mb-2 font-mono text-[15px] text-muted">
          {prefix ? `${prefix}...` : 'Loading'}
        </p>
      )}

      {confirming ? (
        <ConfirmPanel
          actions={
            <>
              <Button variant="danger" onClick={rotate} disabled={busy}>
                Yes, rotate
              </Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </>
          }
        >
          Rotate the key? The current key stops working at once, and every connected agent has to
          be updated with the new one.
        </ConfirmPanel>
      ) : (
        <Button onClick={() => setConfirming(true)}>Rotate key</Button>
      )}
    </div>
  )
}
