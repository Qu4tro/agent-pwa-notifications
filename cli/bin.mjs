#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { loadConfig, saveConfig, resolve, hub, verify, qr, die, sleep, encrypt, decrypt } from './lib/util.mjs'

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const BIN = 'agent-notify-pwa'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    'enc-key': { type: 'string' },
    priority: { type: 'string' },
    project: { type: 'string' },
    task: { type: 'string' },
    'task-id': { type: 'string' },
    model: { type: 'string' },
    kind: { type: 'string' },
    idle: { type: 'string' },
    tag: { type: 'string', multiple: true },
    markdown: { type: 'string' },
    button: { type: 'string', multiple: true },
    color: { type: 'string', multiple: true },
    ack: { type: 'string' },
    e2e: { type: 'boolean' },
    agent: { type: 'string' },
    json: { type: 'boolean' },
    qr: { type: 'boolean' },
    'no-qr': { type: 'boolean' },
    next: { type: 'string' },
    ttl: { type: 'string' },
    version: { type: 'boolean' },
    help: { type: 'boolean' },
  },
})

const cmd = positionals[0]

async function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(q)
  rl.close()
  return a.trim()
}

// -- login: save hub url + agent key, verify ----------------------------------
async function login() {
  console.log('\nAgent Notifications: connect an agent\n')
  const cfg = loadConfig()
  const urlPrompt = cfg.url ? `Hub URL [${cfg.url}]: ` : 'Hub URL: '
  let url = flags.url || (await prompt(urlPrompt)) || cfg.url
  let key = flags.key || (await prompt('Agent key: ')) || cfg.key
  if (!url || !key) die('Both a hub URL and an agent key are required.')
  url = url.replace(/\/$/, '')

  process.stdout.write('Verifying... ')
  const ok = await verify({ url, key })
  if (!ok) die('Could not authenticate. Check the URL and the key.')
  console.log('connected')

  const next = { ...cfg, url, key }
  if (flags['enc-key']) next.encKey = flags['enc-key']
  saveConfig(next)
  console.log('\nSaved. You can now:')
  console.log(`  ${BIN} connect          # write MCP config for your agent`)
  console.log(`  ${BIN} notify "hi"      # send a test update`)
  console.log(`  ${BIN} open             # sign in on your phone (QR)\n`)
}

// -- connect: write the MCP server entry for an agent -------------------------
async function connect() {
  const { url, key } = resolve(flags)
  if (!url || !key) die(`Run \`${BIN} login\` first (or pass --url and --key).`)

  const entry = { url: `${url}/mcp`, headers: { Authorization: `Bearer ${key}` } }
  // Most MCP clients read a project-local .mcp.json.
  const file = '.mcp.json'
  let doc = {}
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      die(`${file} exists but is not valid JSON. Fix or remove it first.`)
    }
  }
  doc.mcpServers = doc.mcpServers || {}
  doc.mcpServers['agent-notifications'] = entry
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log(`\nWrote the agent-notifications MCP server to ./${file}`)
  console.log('  That file holds your key. Keep it out of git.')
  console.log('  Restart your agent (or reload MCP servers) to pick it up.')
  console.log('  Worth installing the skill too:  npx skills add Qu4tro/agent-pwa-notifications\n')
}

// -- open: mint a one-time sign-in link and show it ---------------------------
async function open() {
  const conf = resolve(flags)
  if (!conf.url || !conf.key) die(`Run \`${BIN} login\` first.`)

  const body = {}
  if (flags.next) body.next = flags.next
  if (flags.ttl) body.ttl_minutes = Number(flags.ttl)

  const { status, json } = await hub('POST', '/api/v1/login-link', conf, body)
  if (status !== 200 || !json.ok) die(`Failed (${status}): ${json.error || 'unknown error'}`)

  const minutes = Math.max(1, Math.round((json.expires_at - Date.now()) / 60_000))
  // QR by default; --no-qr prints the URL alone (parseArgs in loose mode does
  // not fold --no-x into x, so read both).
  if (!flags['no-qr'] && flags.qr !== false) {
    console.log('\nScan this on the device you want to sign in:\n')
    qr(json.url)
  }
  console.log(`  ${json.url}\n`)
  console.log(`  Works once, expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  console.log('  Open it on the phone, not here.\n')
}

// -- notify: send an update (good for scripts and hooks) ----------------------
async function notify() {
  const conf = resolve(flags)
  if (!conf.url || !conf.key) die(`Run \`${BIN} login\` first.`)
  const title = positionals.slice(1).join(' ') || die(`Usage: ${BIN} notify "your message"`)

  const blocks = flags.markdown ? [{ type: 'markdown', text: flags.markdown }] : []
  const body = {
    title,
    agent: flags.agent || 'agent-notify-pwa',
    priority: flags.priority ? Number(flags.priority) : 0,
    kind: flags.kind || 'update',
    idle_minutes: flags.idle ? Number(flags.idle) : undefined,
    project: flags.project,
    task: flags.task,
    task_id: flags['task-id'],
    model: flags.model,
    tags: flags.tag,
  }
  await attachBlocks(body, blocks, conf)
  const { status, json } = await hub('POST', '/api/v1/events', conf, body)
  if (status !== 200 || !json.ok) die(`Failed (${status}): ${json.error || 'unknown error'}`)
  await reportChangedAnswers(json, conf)
  console.log(`Sent (${json.id})`)
}

// The human can replace an answer after giving it. A change rides on the next
// call on the thread, so it lands here: one line per answer on stderr, which
// leaves stdout to the caller's pipeline.
async function reportChangedAnswers(json, conf) {
  for (const item of json.changed_answers || []) {
    let answer = item.answer
    let text = item.text
    if (conf.encKey && typeof answer === 'string') answer = await decrypt(conf.encKey, answer)
    if (conf.encKey && typeof text === 'string') text = await decrypt(conf.encKey, text)
    process.stderr.write(`changed answer ${item.id} "${item.title}": ${JSON.stringify({ answer, text })}\n`)
  }
}

// -- ask: post a question, wait for the answer, print it ----------------------
async function ask() {
  const conf = resolve(flags)
  if (!conf.url || !conf.key) die(`Run \`${BIN} login\` first.`)
  const title =
    positionals.slice(1).join(' ') || die(`Usage: ${BIN} ask "question" --button A --button B`)
  const options = flags.button || []
  if (options.length < 1) die('Provide at least one --button option.')
  // Paired with --button by position, and allowed to run short: an option with
  // no --color of its own takes its place in the dashboard's palette.
  const colors = flags.color || []

  const blocks = [
    ...(flags.markdown ? [{ type: 'markdown', text: flags.markdown }] : []),
    { type: 'buttons', id: 'choice', options, ...(colors.length ? { colors } : {}) },
  ]
  const body = {
    title,
    agent: flags.agent || 'agent-notify-pwa',
    project: flags.project,
    task: flags.task,
    task_id: flags['task-id'],
    model: flags.model,
    tags: flags.tag,
    ack: flags.ack,
    idle_minutes: flags.idle ? Number(flags.idle) : undefined,
  }
  await attachBlocks(body, blocks, conf)
  const { status, json } = await hub('POST', '/api/v1/questions', conf, body)
  if (status !== 200 || !json.ok) die(`Failed (${status}): ${json.error || 'unknown error'}`)

  process.stderr.write('Waiting for an answer')
  for (let i = 0; i < 360; i++) {
    const r = await hub('GET', `/api/v1/questions/${json.id}`, conf)
    // A cleared inbox deletes the question, so stop rather than poll a 404
    // until the loop runs out.
    if (r.status !== 200 || !r.json.ok) {
      process.stderr.write('\n')
      die(`Poll failed (${r.status}): ${r.json.error || 'unknown error'}`)
    }
    if (r.json.status === 'answered') {
      let answer = r.json.answer
      if (conf.encKey && typeof answer === 'string') answer = await decrypt(conf.encKey, answer)
      process.stderr.write('\n')
      console.log(JSON.stringify(answer)) // stdout = machine-readable
      return
    }
    if (r.json.status === 'expired') die('The question expired with no answer.')
    process.stderr.write('.')
    await sleep(i < 30 ? 10_000 : 30_000)
  }
  die('Timed out waiting for an answer.')
}

// Encrypt blocks into the request when E2E is on, else send them plain.
async function attachBlocks(body, blocks, conf) {
  if (flags.e2e || conf.encKey) {
    if (!conf.encKey) die('--e2e needs an encryption key (set one with `login --enc-key`).')
    body.enc = true
    body.blocks = await encrypt(conf.encKey, blocks)
  } else {
    body.blocks = blocks
  }
}

// -- status: what this machine is configured to talk to -----------------------
function status() {
  const conf = resolve(flags)
  if (flags.json) {
    console.log(JSON.stringify({ url: conf.url, key: conf.key, encKey: Boolean(conf.encKey) }))
    return
  }
  console.log(`\n${BIN} ${VERSION}`)
  console.log('  hub:     ' + (conf.url || `(none, run \`${BIN} login\`)`))
  console.log('  key:     ' + (conf.key ? `${conf.key.slice(0, 16)}...` : '(none)'))
  console.log('  e2e:     ' + (conf.encKey ? 'on (encryption key set)' : 'off'))
  console.log('')
}

function help() {
  console.log(`
${BIN} ${VERSION} - talk to your Agent Notifications hub

  ${BIN} login [--url U --key K] [--enc-key E]
      Save and verify the hub URL and the account key.

  ${BIN} connect
      Write ./.mcp.json so an MCP client can call the hub.

  ${BIN} open [--no-qr] [--next /path] [--ttl 15]
      Mint a one-time sign-in link and print it (with a QR by default).

  ${BIN} notify "msg" [--priority 0|1|2] [--kind update|done|error]
                          [--project P] [--task T] [--task-id ID] [--model M]
                          [--markdown "..."] [--tag x] [--agent NAME]
                          [--idle MINUTES]
      --kind done is what ends a thread on the dashboard. --idle says how long
      silence still counts as working (default 240).

  ${BIN} ask "question" --button A --button B [--color NAME|#rrggbb]
                          [--markdown "..."] [--ack "..."] [--idle MINUTES]
      Post a question, wait, then print the answer JSON on stdout.
      Every option is already a different colour. --color pairs with --button
      by position when a particular choice should read a particular way:
      blue, violet, mint, rose, amber, cyan, pink, lime, or #rrggbb.

  ${BIN} status [--json]
      Show the saved hub URL, the key prefix and whether E2E is on.

  --e2e         End-to-end encrypt block content (needs an encryption key).
  --version     Print the version.

Environment overrides the saved config:
  AGENT_NOTIFY_PWA_URL, AGENT_NOTIFY_PWA_KEY, AGENT_NOTIFY_PWA_ENC_KEY
`)
}

if (flags.version && !cmd) {
  console.log(VERSION)
} else {
  const run = { login, connect, open, notify, ask, status, help, version: () => console.log(VERSION) }[cmd] || help
  await run()
}
