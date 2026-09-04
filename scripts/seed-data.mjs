// The fake inbox. One export: `threads`, a list of task threads, each with the
// events an agent would have sent while it worked. `scripts/seed-dev.mjs` posts
// them through the real API and then backdates the rows.
//
// Times are minutes ago. Every block type, every event kind, every question
// state and a few deliberately awkward shapes (a 300-character title, twelve
// tags, a wide table, a long code block) are in here, because the point of the
// set is to show the UI what it will actually have to render.

const M = 1
const H = 60
const D = 24 * 60

// -- shorthand block builders -------------------------------------------------
const md = (text) => ({ type: 'markdown', text })
const code = (lang, text) => ({ type: 'code', lang, text })
const kv = (...pairs) => ({ type: 'keyvalue', items: pairs.map(([k, v]) => ({ k, v })) })
const table = (columns, rows) => ({ type: 'table', columns, rows })
const link = (url, label) => ({ type: 'link', url, label })
const image = (url, alt) => ({ type: 'image', url, alt })
const callout = (tone, text) => ({ type: 'callout', tone, text })
const progress = (label, value, max = 100) => ({ type: 'progress', label, value, max })
// `colors` is optional and may run shorter than `options`: an option with no
// entry of its own takes its place in the dashboard's palette.
const buttons = (id, options, colors) => ({
  type: 'buttons',
  id,
  options,
  ...(colors ? { colors } : {}),
})
const form = (id, submitLabel, fields) => ({ type: 'form', id, submitLabel, fields })

// A wide table: twelve columns is the schema maximum.
const wideTable = table(
  ['Route', 'p50', 'p75', 'p90', 'p95', 'p99', 'RPS', 'Err %', 'Cache', 'Bytes', 'Region', 'Trend'],
  [
    ['/api/v1/feed', '18ms', '24ms', '41ms', '62ms', '140ms', '12.4', '0.01', '92%', '4.2kB', 'ams', 'flat'],
    ['/api/v1/projects', '9ms', '12ms', '19ms', '28ms', '71ms', '3.1', '0.00', '97%', '1.1kB', 'ams', 'down'],
    ['/api/v1/thread', '22ms', '31ms', '55ms', '88ms', '210ms', '8.7', '0.02', '88%', '11.9kB', 'ams', 'up'],
    ['/api/v1/events', '31ms', '44ms', '78ms', '119ms', '302ms', '1.9', '0.11', '-', '0.4kB', 'cdg', 'up'],
    ['/api/v1/questions', '27ms', '38ms', '61ms', '95ms', '241ms', '0.4', '0.00', '-', '0.6kB', 'cdg', 'flat'],
    ['/login', '14ms', '19ms', '30ms', '44ms', '96ms', '0.2', '0.00', '99%', '2.8kB', 'lhr', 'flat'],
  ],
)

// A long code block. Nothing here has to compile; it has to be long enough that
// the renderer has to decide what to do about width and height.
const longCode = code(
  'typescript',
  `export async function getFeed(url: URL, env: Env, accountId: string): Promise<Response> {
  const sinceTs = Number(url.searchParams.get('since_ts') ?? '0') || 0
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '100') | 0))

  // The cursor is a timestamp, not an offset: an in-place progress update has to
  // come back through the same window as a brand-new event, and an offset would
  // silently skip it once the row moved.
  const rows = await env.DB.prepare(
    \`SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE e.account_id = ?1 AND COALESCE(e.updated_at, e.created_at) > ?2
     ORDER BY e.created_at DESC LIMIT ?3\`,
  )
    .bind(accountId, sinceTs, limit)
    .all()

  return json({ ok: true, events: (rows.results ?? []).map(hydrate) })
}

// Every handler takes the resolved accountId and scopes its queries to it.
// Miss it on one query and one person's inbox leaks into another's. The tests
// in test/tenancy.spec.ts walk every route with two accounts for that reason.
function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  const enc = Number(row.enc ?? 0) === 1
  const blocks = enc ? (row.blocks as string) : JSON.parse((row.blocks as string) || '[]')
  return {
    id: row.id,
    agent: row.agent,
    kind: row.kind,
    title: row.title,
    blocks,
    enc,
    priority: row.priority,
    project: row.project ?? null,
    task: row.task ?? null,
    model: row.model ?? null,
    tags: JSON.parse((row.tags as string) || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    read_at: row.read_at,
  }
}`,
)

// Twenty key/value pairs: the build matrix of a release.
const bigKv = kv(
  ['version', '1.1.0'],
  ['commit', 'd66164a'],
  ['branch', 'main'],
  ['node', '22.12.0'],
  ['pnpm', '11.3.0'],
  ['wrangler', '4.70.1'],
  ['bundle', '312.4 kB'],
  ['bundle (gzip)', '96.1 kB'],
  ['worker startup', '11 ms'],
  ['routes', '7'],
  ['migrations', '7'],
  ['tests', '186 passed'],
  ['typecheck', 'clean'],
  ['d1 rows read', '4,182'],
  ['d1 rows written', '96'],
  ['kv reads', '211'],
  ['cron', '0 * * * *'],
  ['retention', '90 days'],
  ['session ttl', '365 days'],
  ['instant mode', 'off'],
)

export const threads = [
  // ---------------------------------------------------------------- the fork
  {
    project: 'agent-pwa-notifications',
    task: 'Replace the refresh bar with a connection dot',
    agent: 'claude-code',
    model: 'claude-opus-5',
    taskId: 'apn-connection-dot',
    tags: ['ui', 'polish'],
    events: [
      {
        min: 5 * D + 2 * H,
        kind: 'update',
        title: 'Picked up the connection dot',
        read: true,
        blocks: [
          md(`The refresh bar redraws on **every** poll, so the header never sits still.
Plan:

- drop \`RefreshBar\`, keep the poll
- one dot in the header: green live, amber stale, grey offline
- announce the state change to screen readers, not the tick`),
          kv(['branch', 'ui-connection-dot'], ['base', 'main @ 9c13375']),
        ],
      },
      {
        min: 5 * D + 40,
        kind: 'update',
        title: 'Dot is in, three states',
        read: true,
        blocks: [
          code(
            'tsx',
            `const TONE = {
  live: 'bg-kind-done',
  stale: 'bg-kind-warn',
  offline: 'bg-faint',
} as const

export function ConnectionDot({ state }: { state: keyof typeof TONE }) {
  return (
    <span
      role="status"
      aria-label={STATE_TEXT[state]}
      className={\`size-2 rounded-full \${TONE[state]}\`}
    />
  )
}`,
          ),
          callout('info', 'The bar was 1.2 kB of CSS animation. The dot is 40 bytes of class names.'),
        ],
      },
      {
        min: 5 * D + 15,
        kind: 'question',
        title: 'Amber after one missed poll, or two?',
        status: 'answered',
        answer: { staleness: 'Two' },
        answeredMin: 5 * D + 6,
        pickedMin: 5 * D + 5,
        timeoutMin: 12 * H,
        ack: 'Got it - {answer} missed polls before amber. Pushing the change now.',
        blocks: [
          md('One missed poll is 15 seconds. Two is 30, which is quieter but slower to warn.'),
          buttons('staleness', ['One', 'Two']),
        ],
      },
      {
        min: 5 * D,
        kind: 'done',
        title: 'PR #8 merged, tagged v1.1.0',
        read: true,
        priority: 1,
        blocks: [
          bigKv,
          link('https://github.com/Qu4tro/agent-pwa-notifications/pull/8', 'Qu4tro/agent-pwa-notifications#8'),
        ],
      },
    ],
  },
  {
    project: 'agent-pwa-notifications',
    task: 'Push delivery drops on iOS 18.6',
    agent: 'claude-code',
    model: 'claude-opus-5',
    taskId: 'apn-ios-push',
    tags: ['bug', 'push', 'ios'],
    events: [
      {
        min: 3 * H + 20,
        kind: 'error',
        title: 'Push subscription 410s on every send',
        priority: 2,
        blocks: [
          callout('error', 'Apple returns 410 Gone for the stored endpoint. Every send to this device fails.'),
          code(
            'text',
            `POST https://web.push.apple.com/QDPz.../v1 -> 410
apns-id: 8b41f0d2-1f2b-4d0e-b1a0-6d9e5f2c7a10
reason: BadDeviceToken

  at pushOne (src/server/push.ts:118:11)
  at async Promise.all (index 0)
  at async pushToAll (src/server/push.ts:151:3)
  at async maybePush (src/server/api.ts:62:3)`,
          ),
          kv(['device', 'iPhone 15 Pro, iOS 18.6'], ['subscription age', '41 days'], ['failures', '6 of 6']),
        ],
      },
      {
        min: 2 * H + 50,
        kind: 'update',
        title: 'Reproduced: the endpoint dies when the PWA is reinstalled',
        blocks: [
          md(`Reinstalling the home-screen app mints a **new** subscription and Apple retires the old one.
We store both, and the retired one 410s forever because nothing prunes it.

The spec is explicit: a 404 or 410 means delete the subscription.`),
          progress('Reproductions', 3, 3),
        ],
      },
      {
        min: 2 * H + 10,
        kind: 'question',
        title: 'Prune on 410, or keep a tombstone?',
        status: 'pending',
        timeoutMin: 2 * D,
        priority: 2,
        blocks: [
          md('Deleting is the spec. A tombstone would let Settings say "this device stopped accepting push", which is friendlier but is a second table.'),
          buttons('prune', ['Delete it', 'Tombstone']),
        ],
      },
    ],
  },
  {
    project: 'agent-pwa-notifications',
    task: 'Ship the v1.2 release notes',
    agent: 'codex',
    model: 'gpt-5.2',
    taskId: 'apn-release-notes',
    tags: ['docs', 'release'],
    events: [
      {
        min: 26 * H,
        kind: 'update',
        title: 'Drafted the notes from the changelog',
        read: true,
        blocks: [
          md(`## v1.2.0

### Added
- Connection dot in the header, replacing the refresh bar
- Quick answers on the notification itself for two- and three-option questions

### Fixed
- Push subscriptions are pruned when the browser retires them
- A logged-out first paint no longer trips a hydration mismatch`),
        ],
      },
      {
        min: 25 * H,
        kind: 'question',
        title: 'Which of these is the headline?',
        status: 'answered',
        answer: { headline: 'Quick answers from the notification' },
        answeredMin: 24 * H,
        timeoutMin: 3 * D,
        blocks: [
          md('The release has one thing worth putting at the top. Pick it and the rest becomes the list underneath.'),
          buttons('headline', [
            'Quick answers from the notification',
            'The connection dot',
            'Push subscriptions self-heal',
            'A faster first paint',
          ]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ orchard-checkout
  {
    project: 'orchard-checkout',
    task: 'Migrate Stripe intents to the confirm flow',
    agent: 'codex',
    model: 'gpt-5.2',
    taskId: 'oc-stripe-confirm',
    tags: ['payments', 'migration', 'stripe', 'backend'],
    events: [
      {
        min: 9 * D,
        kind: 'update',
        title: 'Inventory of every call site',
        read: true,
        blocks: [
          md('Forty-one call sites across eleven files. Most are the same three shapes.'),
          table(
            ['Shape', 'Sites', 'Files', 'Mechanical?'],
            [
              ['create + confirm in one call', '23', '6', 'yes'],
              ['create, then confirm on webhook', '11', '3', 'yes'],
              ['manual capture, delayed', '5', '1', 'no'],
              ['legacy Charges API', '2', '1', 'no'],
            ],
          ),
        ],
      },
      {
        min: 8 * D + 4 * H,
        kind: 'update',
        title: 'Codemod handles the two mechanical shapes',
        read: true,
        blocks: [
          longCode,
          progress('Call sites migrated', 34, 41),
        ],
      },
      {
        min: 7 * D,
        kind: 'question',
        title: 'The five delayed-capture sites: migrate or freeze?',
        status: 'answered',
        answer: {
          plan: {
            approach: 'Freeze them behind a flag',
            deadline: '2026-10-15',
            owner: 'payments',
            risk: 'medium',
            notify: 'Yes',
            notes: 'Freeze is fine as long as the flag is on the same dashboard as the rest. Do not let it become permanent.',
          },
        },
        answeredMin: 6 * D + 20 * H,
        pickedMin: 6 * D + 19 * H,
        timeoutMin: 3 * D,
        blocks: [
          md(`Delayed capture is the only shape the codemod cannot do. Migrating it touches the
reconciliation job, which nobody has read in a year.`),
          callout('warn', 'These five sites carry about 4% of volume, and all of the refunds.'),
          form('plan', 'Set the plan', [
            { id: 'approach', kind: 'radio', label: 'Approach', options: ['Migrate now', 'Freeze them behind a flag', 'Leave them alone'], required: true },
            { id: 'deadline', kind: 'text', label: 'Deadline', placeholder: 'YYYY-MM-DD' },
            { id: 'owner', kind: 'select', label: 'Owner', options: ['payments', 'platform', 'me'] },
            { id: 'risk', kind: 'select', label: 'Risk you accept', options: ['low', 'medium', 'high'] },
            { id: 'notify', kind: 'checkbox', label: 'Tell the team in #payments', options: ['Yes'] },
            { id: 'notes', kind: 'textarea', label: 'Anything else', placeholder: 'Optional' },
          ]),
        ],
      },
      {
        min: 5 * D,
        kind: 'update',
        title: 'Flag is in, 34 sites live in staging',
        read: true,
        blocks: [
          kv(['flag', 'checkout.delayed_capture.legacy'], ['default', 'on'], ['staging', '34 of 41 migrated'], ['prod', 'not yet']),
          callout('success', 'Staging has run 2,100 payments through the new flow with no drift against the ledger.'),
        ],
      },
      {
        min: 2 * D + 3 * H,
        kind: 'update',
        title: 'Latency after the migration',
        read: true,
        blocks: [wideTable, md('p99 on `/api/v1/events` is up 40ms, which is the extra confirm round trip. Everything else is flat or better.')],
      },
      {
        min: 40,
        kind: 'question',
        title: 'Roll the flag to production today?',
        status: 'pending',
        timeoutMin: 8 * H,
        ack: 'Understood - {answer}. I will report back either way.',
        blocks: [
          md('Staging is clean for nine days. Rolling means 96% of volume moves to the confirm flow; the frozen five stay where they are.'),
          buttons('roll', ['Roll it', 'Wait', 'Roll at 5%'], ['mint', 'amber']),
        ],
      },
    ],
  },
  {
    project: 'orchard-checkout',
    task: 'Flaky test: refund webhook',
    agent: 'orchard-ci',
    model: null,
    taskId: 'oc-flaky-refund',
    tags: ['ci', 'flaky'],
    events: [
      {
        min: 4 * D,
        kind: 'error',
        title: 'refund.webhook.spec.ts failed on main (attempt 1 of 3)',
        priority: 1,
        read: true,
        blocks: [
          code(
            'text',
            `FAIL test/refund.webhook.spec.ts > settles a partial refund
AssertionError: expected 'pending' to be 'settled'

  53 |   await webhook(refundEvent({ amount: 400 }))
> 54 |   expect(await status(id)).toBe('settled')
     |          ^
  55 | })`,
          ),
          kv(['seen', '7 times in 40 runs'], ['always', 'attempt 1'], ['never', 'locally']),
        ],
      },
      {
        min: 3 * D + 22 * H,
        kind: 'question',
        title: 'Quarantine the flaky refund test while it is investigated?',
        status: 'expired',
        timeoutMin: 6 * H,
        blocks: [
          md('It has blocked four merges this week. Quarantine keeps the signal for everything else, and hides one real regression if there is one.'),
          buttons('quarantine', ['Quarantine', 'Leave it red']),
        ],
      },
      {
        min: 3 * D,
        kind: 'update',
        title: 'It was the clock, not the webhook',
        read: true,
        blocks: [
          md('The test advances fake timers by 400ms; the settle job waits 500ms. On a cold worker the first run loses the race. Nothing is wrong with the webhook.'),
          callout('success', 'Fixed by waiting on the job, not the clock. 60 consecutive green runs.'),
        ],
      },
    ],
  },
  {
    project: 'orchard-checkout',
    task: 'Apple Pay button on the cart page',
    agent: 'cursor',
    model: 'claude-sonnet-5',
    taskId: 'oc-apple-pay',
    tags: ['frontend', 'payments'],
    events: [
      {
        min: 12,
        kind: 'update',
        title: 'Building the sheet',
        live: true,
        blocks: [
          progress('Merchant validation, sheet, callbacks', 62),
          md('Domain is verified, the sheet opens. Left: the `onpaymentauthorized` round trip and the cart total refresh.'),
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ sunset-cli
  {
    project: 'sunset-cli',
    task: 'Port the config loader to serde',
    agent: 'claude-code',
    model: 'claude-sonnet-5',
    taskId: 'sc-serde',
    tags: ['rust', 'refactor'],
    events: [
      {
        min: 6 * D,
        kind: 'update',
        title: 'Hand-rolled parser is 400 lines and wrong about arrays',
        read: true,
        blocks: [
          code(
            'rust',
            `#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Config {
    #[serde(default = "default_root")]
    pub root: PathBuf,
    #[serde(default)]
    pub profiles: BTreeMap<String, Profile>,
    #[serde(default, deserialize_with = "one_or_many")]
    pub ignore: Vec<String>,
}`,
          ),
          md('`deny_unknown_fields` turns a typo in the config into an error with a line number, which the hand-rolled parser never managed.'),
        ],
      },
      {
        min: 5 * D + 6 * H,
        kind: 'done',
        title: 'Ported, 400 lines out, 9 tests in',
        read: true,
        priority: 1,
        blocks: [
          kv(['deleted', '412 lines'], ['added', '96 lines'], ['tests', '9 new'], ['binary', '-38 kB']),
        ],
      },
    ],
  },
  {
    project: 'sunset-cli',
    task: 'Release 0.9.0',
    agent: 'claude-code',
    model: 'claude-sonnet-5',
    taskId: 'sc-release-090',
    tags: ['release'],
    events: [
      {
        min: 4 * D,
        kind: 'done',
        title: 'v0.9.0 is on crates.io',
        read: true,
        blocks: [
          md('Six weeks, 34 commits, two breaking changes, both in the config file.'),
          link('https://crates.io/crates/sunset-cli', 'crates.io/crates/sunset-cli'),
          image('http://localhost:3000/icon-512.png', 'The release banner'),
        ],
      },
      {
        min: 3 * D + 2 * H,
        kind: 'update',
        title: 'A screenshot that will not load, on purpose',
        blocks: [
          md('The URL below is gone. This event is here so the image error state gets looked at too.'),
          image('http://localhost:3000/screenshots/does-not-exist.png', 'A screenshot that is not there'),
        ],
      },
    ],
  },

  // ------------------------------------------------------- research/pricing
  {
    project: 'research/pricing-teardown',
    task: 'Competitor pricing sweep',
    agent: 'research-bot',
    model: 'claude-opus-5',
    taskId: 'rp-sweep-1',
    tags: ['research', 'pricing', 'q3'],
    events: [
      {
        min: 11 * D,
        kind: 'update',
        title: 'Nine products, public pricing pages only',
        read: true,
        blocks: [
          table(
            ['Product', 'Free tier', 'Entry', 'Team', 'Per seat', 'Usage cap', 'Notes'],
            [
              ['ntfy', 'yes, self-host', '$0', '$9/mo', 'no', 'unlimited self-hosted', 'the baseline'],
              ['Pushover', '7-day trial', '$5 once', '$50/mo', 'no', '10k/mo', 'one-time desktop licence'],
              ['Pushbullet', 'yes, 100/mo', '$4.99/mo', '-', 'no', 'unlimited on pro', 'consumer-first'],
              ['Courier', 'yes, 10k/mo', '$99/mo', '$499/mo', 'no', 'per notification', 'developer platform'],
              ['Knock', 'yes, 10k/mo', '$250/mo', 'custom', 'no', 'per notification', 'enterprise slant'],
              ['OneSignal', 'yes, 10k subs', '$9/mo', '$99/mo', 'no', 'per subscriber', 'ads-adjacent'],
              ['Novu', 'yes, 30k/mo', '$250/mo', 'custom', 'no', 'per event', 'open source core'],
              ['Slack (as inbox)', 'yes, limited', '$8.75/user', '$15/user', 'yes', 'message retention', 'not a fair comparison'],
              ['Telegram bot', 'yes', '$0', '$0', 'no', 'rate limited', 'free, not private'],
            ],
          ),
          callout('info', 'Nobody in this list charges per human. Everybody charges per notification or per subscriber.'),
        ],
      },
      {
        min: 10 * D,
        kind: 'question',
        title: 'Which axis should the teardown argue on?',
        status: 'answered',
        answer: { axis: 'Cost at zero scale' },
        answeredMin: 9 * D + 20 * H,
        pickedMin: 9 * D + 19 * H,
        timeoutMin: 2 * D,
        blocks: [
          md('The interesting claim is that a one-person hub costs nothing to run, and every product here has a floor.'),
          buttons('axis', ['Cost at zero scale', 'Privacy', 'Latency', 'Ask-and-wait as a feature']),
        ],
      },
      {
        min: 9 * D,
        kind: 'done',
        title: 'Teardown written, 1,900 words',
        read: true,
        blocks: [
          md('The argument lands on the free tier: every hosted product has a price floor above zero the moment you leave the trial, and a Worker plus D1 plus KV does not.'),
          link('https://example.com/pricing-teardown', 'Read the draft'),
        ],
      },
    ],
  },

  // -------------------------------------------------------------------- home-lab
  {
    project: 'home-lab',
    task: 'Certificate renewal',
    agent: 'deploy-cron',
    model: null,
    taskId: 'hl-certs',
    tags: ['infra', 'tls'],
    events: [
      {
        min: 5 * H,
        kind: 'error',
        title: 'acme renewal failed for hub.internal, 6 days left',
        priority: 2,
        blocks: [
          callout('error', 'DNS-01 challenge timed out three times. The certificate expires in six days.'),
          kv(['domain', 'hub.internal'], ['expires', '2026-09-10T04:12:00Z'], ['issuer', "Let's Encrypt R11"], ['attempts', '3']),
        ],
      },
      {
        min: 4 * H + 30,
        kind: 'question',
        title: 'Fall back to HTTP-01 for this renewal?',
        status: 'pending',
        priority: 2,
        timeoutMin: 12 * H,
        blocks: [
          md('HTTP-01 needs port 80 open to the box for about thirty seconds. DNS-01 is failing because the provider API is rate limiting.'),
          buttons('fallback', ['Yes', 'No']),
        ],
      },
    ],
  },

  // ------------------------------------------------------- a very long project name
  {
    project: 'internal-tooling-migration-2026-q3-phase-two',
    task: 'Decommission the old dashboard Worker and move every consumer to the new hub URL before the DNS record is released',
    agent: 'claude-code',
    model: 'claude-opus-5',
    taskId: 'itm-decom',
    tags: ['migration', 'infra', 'dns', 'cleanup', 'q3', 'phase-two', 'tracked', 'blocked', 'has-owner', 'reviewed', 'scheduled', 'noisy'],
    events: [
      {
        min: 2 * D,
        kind: 'update',
        title:
          'Every consumer of the old dashboard Worker has now been enumerated, contacted where a human owns it, and either migrated to the new hub URL or scheduled for migration before the DNS record is released at the end of the quarter, with the two exceptions noted below which have no owner anyone can find and which will be cut off',
        read: true,
        blocks: [
          md('The title above is the schema maximum, on purpose. It is what a verbose agent will eventually send.'),
          table(
            ['Consumer', 'Owner', 'State'],
            [
              ['nightly-report', 'platform', 'migrated'],
              ['grafana webhook', 'infra', 'migrated'],
              ['old iOS shortcut', '?', 'no owner'],
              ['a cron on someone laptop', '?', 'no owner'],
            ],
          ),
        ],
      },
      {
        min: 47 * H,
        kind: 'update',
        title: 'Callout tones, all four',
        blocks: [
          callout('info', 'Info: the DNS record is released on 2026-09-30.'),
          callout('success', 'Success: fourteen of sixteen consumers are on the new URL.'),
          callout('warn', 'Warning: two consumers have no owner and will simply stop working.'),
          callout('error', 'Error: the old Worker still serves 40 requests a day, so somebody is still on it.'),
        ],
      },
    ],
  },

  // --------------------------------------------------------------- unicode / emoji
  {
    project: 'café-menu 🍵',
    task: 'Translate the winter menu',
    agent: 'claude-code',
    model: 'claude-sonnet-5',
    taskId: 'cm-i18n',
    tags: ['i18n', '🍵'],
    events: [
      {
        min: 30 * H,
        kind: 'update',
        title: 'Winter menu: 日本語, Português, العربية',
        read: true,
        blocks: [
          table(
            ['Item', '日本語', 'Português', 'العربية'],
            [
              ['Matcha latte', '抹茶ラテ', 'Latte de matcha', 'لاتيه ماتشا'],
              ['Hot chocolate', 'ホットチョコレート', 'Chocolate quente', 'شوكولاتة ساخنة'],
              ['Cinnamon bun', 'シナモンロール', 'Pão de canela', 'لفة القرفة'],
            ],
          ),
          md('The Arabic column is right-to-left inside a left-to-right table. Worth a look on a phone.'),
        ],
      },
      {
        min: 29 * H,
        kind: 'question',
        title: 'Eight ways to say the same thing',
        status: 'pending',
        timeoutMin: 4 * D,
        blocks: [
          md('Eight options is the schema maximum, and no notification can carry them. This one has to be opened.'),
          buttons('translation', [
            'Matcha latte',
            'Matcha Latte',
            'matcha latte',
            'Green tea latte',
            '抹茶ラテ',
            'Latte de matcha',
            'Matcha au lait',
            'Just "matcha"',
          ]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------------- dotfiles
  {
    project: 'dotfiles',
    task: 'zsh startup is 400ms',
    agent: 'claude-code',
    model: 'claude-sonnet-5',
    taskId: null,
    tags: ['perf'],
    events: [
      {
        min: 13 * D,
        kind: 'done',
        title: 'zsh starts in 90ms now',
        read: true,
        blocks: [
          md('`compinit` ran on every shell. It is cached daily now, and nvm is lazy.'),
          kv(['before', '412 ms'], ['after', '89 ms']),
        ],
      },
    ],
  },

  // ------------------------------------------------------- no project at all (NULL)
  {
    project: null,
    task: null,
    agent: 'shell',
    model: null,
    taskId: null,
    tags: [],
    events: [
      {
        min: 90,
        kind: 'update',
        title: 'rsync of ~/photos finished',
        blocks: [kv(['files', '12,481'], ['moved', '3.2 GB'], ['took', '14m 02s'])],
      },
      {
        min: 6 * H,
        kind: 'error',
        title: 'curl: (28) Operation timed out after 30001 ms',
        priority: 1,
        read: true,
        blocks: [code('bash', "curl -sS --max-time 30 https://api.example.com/health || notify 'health check timed out'")],
      },
      {
        min: 20 * H,
        kind: 'update',
        title: 'A bare title and nothing else',
        blocks: [],
      },
    ],
  },
]

// -- Encrypted thread ---------------------------------------------------------
// Blocks and the answer are ciphertext in the database. seed-dev.mjs encrypts
// them with the seed key and prints it, so it can be pasted into Settings to
// watch the same rows decrypt.
export const encryptedThread = {
  project: 'orchard-checkout',
  task: 'Rotate the production Stripe keys',
  agent: 'claude-code',
  model: 'claude-opus-5',
  taskId: 'oc-key-rotation',
  tags: ['secrets', 'e2e'],
  events: [
    {
      min: 3 * H,
      kind: 'update',
      title: 'Rotation plan (encrypted)',
      enc: true,
      blocks: [
        md('The old restricted key is still on two workers. Both are redeployed with the new key before the old one is revoked.'),
        kv(['new key', 'rk_live_51H...9xQ'], ['revoke at', '2026-09-05T09:00:00Z'], ['workers', 'checkout-api, refund-worker']),
      ],
    },
    {
      min: 2 * H + 40,
      kind: 'question',
      title: 'Revoke the old key now? (encrypted)',
      enc: true,
      status: 'pending',
      timeoutMin: 6 * H,
      blocks: [
        md('Both workers report the new key in their health check. Revoking now closes the window where two keys are live.'),
        buttons('revoke', ['Revoke', 'Wait an hour']),
      ],
    },
  ],
}

// -- Filler: a nightly job, one thread per night ------------------------------
// Volume, and a project whose list is long enough to scroll. Nothing here is
// interesting on its own; the point is that the list has to survive it.
export function nightlyThreads() {
  const out = []
  for (let night = 1; night <= 21; night++) {
    const failed = night === 4 || night === 13
    const base = night * D + 3 * H
    const gb = (180 + ((night * 7) % 24)) / 10
    const events = [
      {
        min: base,
        kind: 'update',
        title: `Backup started (${21 - night + 1} of 21)`,
        read: true,
        blocks: [kv(['targets', 'nas, vault, photos'], ['mode', 'incremental'])],
      },
    ]
    if (failed) {
      events.push({
        min: base - 40,
        kind: 'error',
        title: 'Backup failed: vault target unreachable',
        priority: 1,
        read: night !== 4,
        blocks: [
          callout('error', 'ssh: connect to host vault port 22: No route to host'),
          kv(['completed', 'nas, photos'], ['missing', 'vault'], ['retry', 'next night']),
        ],
      })
    } else {
      events.push({
        min: base - 52,
        kind: 'done',
        title: `Backup done, ${gb.toFixed(1)} GB`,
        read: true,
        blocks: [
          kv(['moved', `${gb.toFixed(1)} GB`], ['files', String(9000 + night * 137)], ['took', `${45 + (night % 12)}m`]),
          progress('Vault capacity', 61 + (night % 9)),
        ],
      })
    }
    out.push({
      project: 'home-lab',
      task: `Nightly backup, night ${night}`,
      agent: 'deploy-cron',
      model: null,
      taskId: `hl-backup-${String(night).padStart(2, '0')}`,
      tags: ['backup', 'cron'],
      events,
    })
  }
  return out
}
