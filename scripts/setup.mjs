#!/usr/bin/env node
// One-command setup: generate credentials, push them as Worker secrets, apply
// the D1 schema, deploy, and print how to sign in the first time.
//
//   pnpm setup
//
// Safe to re-run: pass --rotate to mint brand-new keys (invalidates old ones).
import { generateVapidKeys, randomKey, loadSecrets, saveSecrets, putSecret, wrangler, readWorkerName } from './lib.mjs'

const rotate = process.argv.includes('--rotate')
const existing = loadSecrets()

let secrets
if (existing && !rotate) {
  console.log('Reusing the existing credentials (pass --rotate to regenerate).\n')
  secrets = existing
} else {
  const vapid = generateVapidKeys()
  secrets = {
    APP_SECRET: randomKey(32),
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: existing?.VAPID_SUBJECT || 'mailto:admin@example.invalid',
    WORKER_URL: existing?.WORKER_URL,
  }
  saveSecrets(secrets)
  console.log('Generated credentials into .agent-dash.local.json (gitignored).\n')
}

console.log('Applying the database schema...')
wrangler(['d1', 'migrations', 'apply', 'agent-dash', '--remote'])

console.log('\nSetting Worker secrets...')
for (const name of ['APP_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  putSecret(name, secrets[name])
}

console.log('\nDeploying...')
wrangler(['deploy'])

const name = readWorkerName()
const url = secrets.WORKER_URL || `https://${name}.<your-subdomain>.workers.dev`

console.log('\n--------------------------------------------------------')
console.log('The hub is live at ' + url)
console.log('')
console.log('Sign in for the first time. Sign-in is by one-time code, and')
console.log('there are two ways to receive it:')
console.log('')
console.log('  a. No email sender configured (the default). Open the hub in a')
console.log('     browser, enter your email, and read the code from the logs:')
console.log('')
console.log('       pnpm exec wrangler tail')
console.log('')
console.log('  b. With a Resend account, set a sender and the code arrives by')
console.log('     email:')
console.log('')
console.log('       pnpm exec wrangler secret put RESEND_API_KEY')
console.log('       # and EMAIL_FROM in wrangler.jsonc vars')
console.log('')
console.log('That first sign-in creates the account and shows its agent key')
console.log('once. Then close registration to your own address:')
console.log('')
console.log('  pnpm exec wrangler secret put ALLOWED_EMAILS')
console.log('')
console.log('Connect an agent with that key:')
console.log('')
console.log('  npx agent-pwa-notifications login --url ' + url + ' --key <AGENT_KEY>')
console.log('  npx agent-pwa-notifications connect')
console.log('')
console.log('After that, `agent-notify-pwa open` mints a one-time link to sign')
console.log('in on the phone, with no email round trip.')
console.log('--------------------------------------------------------')
