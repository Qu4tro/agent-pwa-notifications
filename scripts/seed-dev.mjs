#!/usr/bin/env node
// Fill the LOCAL inbox with a large fake dataset, for looking at the front end.
//
//   pnpm dev              # in another terminal, port 3000
//   node scripts/seed-dev.mjs
//
// It posts every event through the real API, so blocks are validated by the
// same zod schema production uses, then backdates the rows with one SQL pass
// (the API always stamps "now", and a feed where everything happened in the
// same second tells you nothing about the UI).
//
// Local only. It talks to http://localhost:3000 and to the miniflare D1 under
// .wrangler/state, and it deletes the seeded account's events before it starts.
//
//   --url <origin>    default http://localhost:3000
//   --email <addr>    account to seed, default dev@example.com
//   --keep            do not wipe the account's existing events first

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threads, encryptedThread, nightlyThreads } from './seed-data.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const URL_BASE = (flag('--url', 'http://localhost:3000') || '').replace(/\/$/, '')
const EMAIL = flag('--email', 'dev@example.com')
const KEEP = args.includes('--keep')

// Fixed, so a re-seed does not invalidate the key in your CLI config or the
// encryption key you pasted into Settings. Local dev values, nothing else.
const AGENT_KEY = 'ad_live_devseed0000devseed0000dev'
const ENC_KEY = Buffer.from('agent-notifications-dev-seed-key').toString('base64url')

const NOW = Date.now()
const DAY_MS = 86_400_000

// -- helpers ------------------------------------------------------------------

const sha256hex = async (s) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex')

const ENC32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function ulid(time = Date.now()) {
  let out = ''
  let t = time
  for (let i = 9; i >= 0; i--) {
    out = ENC32[t % 32] + out
    t = Math.floor(t / 32)
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) out += ENC32[rnd[i] % 32]
  return out
}

// Same envelope as src/lib/e2e.ts: base64url( iv(12) || ciphertext+tag ).
async function encryptValue(value) {
  const key = await crypto.subtle.importKey(
    'raw',
    Buffer.from(ENC_KEY, 'base64url'),
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return Buffer.from(out).toString('base64url')
}

// One wrangler call per SQL file. The generated SQL holds ids, numbers and
// small JSON answers only - no free text - so nothing in it can confuse the
// statement splitter.
function runSql(sql) {
  const file = join(mkdtempSync(join(tmpdir(), 'seed-')), 'seed.sql')
  writeFileSync(file, sql)
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'agent-dash', '--local', `--file=${file}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}

const sqlStr = (v) => {
  const s = String(v)
  if (s.includes(';')) throw new Error(`refusing to put a semicolon in generated SQL: ${s}`)
  return `'${s.replace(/'/g, "''")}'`
}

async function post(path, body) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_KEY}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    throw new Error(`POST ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 400)}`)
  }
  return data
}

// -- 1. the account -----------------------------------------------------------

const accountId = ulid()
const hash = await sha256hex(AGENT_KEY)
runSql(
  `INSERT INTO accounts (id, email, agent_key_hash, agent_key_prefix, created_at, last_login_at)
   VALUES (${sqlStr(accountId)}, ${sqlStr(EMAIL)}, ${sqlStr(hash)}, ${sqlStr(AGENT_KEY.slice(0, 16))}, ${NOW - 30 * DAY_MS}, ${NOW})
   ON CONFLICT(email) DO UPDATE SET agent_key_hash = excluded.agent_key_hash,
                                    agent_key_prefix = excluded.agent_key_prefix,
                                    last_login_at = excluded.last_login_at;`,
)

if (!KEEP) {
  const scope = `(SELECT id FROM accounts WHERE email = ${sqlStr(EMAIL)})`
  runSql(
    `DELETE FROM questions WHERE event_id IN (SELECT id FROM events WHERE account_id = ${scope});
     DELETE FROM events WHERE account_id = ${scope};
     DELETE FROM account_settings WHERE account_id = ${scope};`,
  )
}

// -- 2. post every event, oldest first ----------------------------------------

const all = [...threads, ...nightlyThreads(), encryptedThread]
const rows = [] // { id, createdAt, updatedAt, readAt, question }

const posts = []
for (const t of all) {
  for (const e of t.events) {
    posts.push({ t, e, at: NOW - e.min * 60_000 })
  }
}
posts.sort((a, b) => a.at - b.at)

for (const { t, e, at } of posts) {
  const enc = e.enc === true
  const meta = {
    agent: t.agent,
    project: t.project ?? undefined,
    task: t.task ?? undefined,
    model: t.model ?? undefined,
    tags: t.tags ?? [],
    task_id: t.taskId ?? undefined,
    enc: enc || undefined,
    blocks: enc ? await encryptValue(e.blocks) : e.blocks,
  }

  let id
  if (e.kind === 'question') {
    const timeoutMin = e.timeoutMin ?? 24 * 60
    const res = await post('/api/v1/questions', {
      ...meta,
      title: e.title,
      ack: e.ack,
      // The API measures the timeout from now; we rewrite it from created_at below.
      timeout_minutes: timeoutMin,
    })
    id = res.id
    const status = e.status ?? 'pending'
    const answeredAt = e.answeredMin != null ? NOW - e.answeredMin * 60_000 : null
    rows.push({
      id,
      createdAt: at,
      updatedAt: at,
      readAt: status === 'pending' ? null : (answeredAt ?? at),
      question: {
        status,
        answer: e.answer ? (enc ? await encryptValue(e.answer) : JSON.stringify(e.answer)) : null,
        answeredAt,
        pickedUpAt: e.pickedMin != null ? NOW - e.pickedMin * 60_000 : null,
        timeoutAt: at + timeoutMin * 60_000,
      },
    })
  } else {
    const res = await post('/api/v1/events', {
      ...meta,
      title: e.title,
      kind: e.kind,
      priority: e.priority ?? 0,
    })
    id = res.id
    rows.push({
      id,
      createdAt: at,
      // A "live" event was edited in place after it was posted, so its
      // updated_at runs ahead of created_at - that is what the feed cursor and
      // the connection dot are for.
      updatedAt: e.live ? NOW - 90_000 : at,
      readAt: e.read ? at + 4 * 60_000 : null,
      question: null,
    })
  }
  process.stdout.write('.')
}
process.stdout.write('\n')

// -- 3. backdate ---------------------------------------------------------------

const stmts = []
for (const r of rows) {
  stmts.push(
    `UPDATE events SET created_at = ${r.createdAt}, updated_at = ${r.updatedAt}, ` +
      `read_at = ${r.readAt ?? 'NULL'}, expires_at = ${r.createdAt + 90 * DAY_MS} ` +
      `WHERE id = ${sqlStr(r.id)};`,
  )
  if (r.question) {
    const q = r.question
    stmts.push(
      `UPDATE questions SET status = ${sqlStr(q.status)}, answer = ${q.answer ? sqlStr(q.answer) : 'NULL'}, ` +
        `answered_at = ${q.answeredAt ?? 'NULL'}, picked_up_at = ${q.pickedUpAt ?? 'NULL'}, ` +
        `timeout_at = ${q.timeoutAt} WHERE event_id = ${sqlStr(r.id)};`,
    )
  }
}
// A couple of saved settings, so Settings is not showing defaults either.
const acctSql = `(SELECT id FROM accounts WHERE email = ${sqlStr(EMAIL)})`
stmts.push(
  `INSERT INTO account_settings (account_id, key, value) VALUES (${acctSql}, 'quiet_hours', ` +
    `'{"start":1380,"end":420,"offsetMin":60}') ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value;`,
)
runSql(stmts.join('\n'))

// -- 4. a way in ---------------------------------------------------------------

const linkRes = await fetch(`${URL_BASE}/api/v1/login-link`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_KEY}` },
  body: JSON.stringify({ ttl_minutes: 60 }),
})
const linkData = await linkRes.json().catch(() => ({}))

const counts = rows.reduce(
  (acc, r) => {
    if (r.question) acc[r.question.status] = (acc[r.question.status] ?? 0) + 1
    if (!r.readAt) acc.unread++
    return acc
  },
  { unread: 0 },
)

console.log(`\nSeeded ${rows.length} events across ${all.length} threads into ${EMAIL}.`)
console.log(`  unread: ${counts.unread}   questions: pending ${counts.pending ?? 0}, answered ${counts.answered ?? 0}, expired ${counts.expired ?? 0}`)
console.log(`\n  agent key:      ${AGENT_KEY}`)
console.log(`  encryption key: ${ENC_KEY}   (Settings -> Encryption, to read the two encrypted rows)`)
if (linkData.ok) console.log(`\n  sign in:  ${linkData.url}\n`)
else console.log(`\n  login link failed: ${JSON.stringify(linkData).slice(0, 200)}\n`)
