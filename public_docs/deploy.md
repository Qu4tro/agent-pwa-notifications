# Deploy your own hub

This is a single-user push inbox that runs on one Cloudflare Worker. It fits in
the free plan: Workers, D1 and KV, no Durable Objects unless you opt in.

You need a Cloudflare account, Node 22.12 or newer, and pnpm.

## 1. Clone and install

```bash
git clone https://github.com/Qu4tro/agent-pwa-notifications.git
cd agent-pwa-notifications
pnpm install --frozen-lockfile
pnpm exec wrangler login
```

## 2. Create the database and the session store

```bash
pnpm exec wrangler d1 create agent-dash
pnpm exec wrangler kv namespace create SESSIONS
```

Both commands print an id. Paste them into `wrangler.jsonc`, along with your
account id:

```jsonc
"account_id": "<your account id>",
"d1_databases": [{ "binding": "DB", "database_name": "agent-dash", "database_id": "<printed id>" }],
"kv_namespaces": [{ "binding": "SESSIONS", "id": "<printed id>" }]
```

The D1 database keeps the name `agent-dash`: D1 has no rename, and every
`wrangler d1` command in this repo refers to it by that name. It is only a
label; nothing else depends on it.

Pick a Worker name in the same file. It becomes your URL,
`https://<name>.<your-subdomain>.workers.dev`.

## 3. Generate keys, migrate and deploy

```bash
pnpm setup
```

That generates `APP_SECRET` and a VAPID key pair, writes them to
`.agent-notify-pwa.local.json` (gitignored), sets them as Worker secrets, applies the
D1 migrations and deploys. Re-running it reuses the existing keys; pass
`--rotate` to mint new ones, which invalidates every session and every push
subscription.

To do it by hand instead:

```bash
pnpm exec wrangler d1 migrations apply agent-dash --remote
pnpm exec wrangler secret put APP_SECRET
pnpm exec wrangler secret put VAPID_PUBLIC_KEY
pnpm exec wrangler secret put VAPID_PRIVATE_KEY
pnpm exec wrangler secret put VAPID_SUBJECT      # mailto:you@example.com
pnpm build && pnpm exec wrangler deploy
```

## 4. Sign in the first time

Sign-in is by one-time code. Without an email sender configured, the code is
written to the Worker log instead of being sent.

1. Run `pnpm exec wrangler tail` in one terminal.
2. Open the hub URL in a browser, enter your email address, and submit.
3. Read the six-digit code from the tail output and type it in.

That first sign-in creates the account and shows its agent key once. Copy it
now: only a hash is stored, so it cannot be shown again. You can mint a new one
later from Settings, which invalidates the old one.

If you would rather receive the code by email, set a Resend API key and a
sender:

```bash
pnpm exec wrangler secret put RESEND_API_KEY
# and set EMAIL_FROM in the wrangler.jsonc vars, e.g.
#   "EMAIL_FROM": "Agent Notifications <login@yourdomain>"
```

## 5. Close registration

With an email sender configured, anyone who knows the URL can create an account.
`ALLOWED_EMAILS` is a comma-separated allow list of addresses that may sign in:

```bash
printf 'you@example.com\n' | pnpm exec wrangler secret put ALLOWED_EMAILS
```

Any other address gets the same "ok" on the code request and the same "That code
has expired" on submit, so the list cannot be probed. Leave the secret unset and
the hub stays open, which only matters once a sender is configured.

Setting `ALLOWED_EMAILS` does not touch accounts that already exist.

## 6. Install the app and enable notifications

Open the hub URL on the phone, add it to the home screen, open the installed
app, then Settings, Enable notifications. Do the same in a desktop browser if
you want notifications there.

Web Push needs the app installed on iOS. On Android and on the desktop the
browser tab is enough, but installing it gives a better result.

## 7. Connect an agent

```bash
node cli/bin.mjs login --url https://<your-worker>.workers.dev --key ad_live_...
node cli/bin.mjs connect      # writes ./.mcp.json for an MCP client
```

The CLI runs straight from the checkout, with `qrcode-terminal` as its only
dependency. On Arch Linux the AUR package `agent-pwa-notifications` installs it
system wide and puts `agent-notify-pwa` on the PATH; the examples below use
that name.

Or install the skill for an agent that reads Agent Skills:

```bash
npx skills add Qu4tro/agent-pwa-notifications
```

Or use plain HTTP: see `GET /api/v1/openapi.json` on your own hub.

## Signing in on another device

Once an agent holds the account key, no later device needs the email round trip:

```bash
agent-notify-pwa open           # prints a one-time link and a QR to scan
agent-notify-pwa open --no-qr   # the URL alone
```

The link works once, expires after 15 minutes by default (`--ttl`, 1 to 60), and
is rate limited to 10 an hour. Scan it on the device you want to sign in; do not
open it on the machine that printed it.

The account key already lets an agent post, update and clear the inbox. A login
link adds read and answer access on top. On a single-user hub that is the same
trust boundary; on a shared one it would not be.

## Settings that are worth knowing

Vars, in `wrangler.jsonc`:

| Var | Default | What |
|---|---|---|
| `EVENT_RETENTION_DAYS` | `90` | The hourly cron archives events older than this. They leave the app; the rows stay. |
| `SESSION_TTL_DAYS` | `365` | How long a signed-in browser stays signed in. |
| `INSTANT` | `0` | `1` swaps polling for a WebSocket to a hibernating Durable Object. |
| `EMAIL_FROM` | unset | Sender for one-time codes. Needs `RESEND_API_KEY`. |

Secrets, set with `wrangler secret put`:

| Secret | Required | What |
|---|---|---|
| `APP_SECRET` | yes | HMAC key for session integrity and code hashing. |
| `VAPID_PUBLIC_KEY` | yes | Served to the browser so it can subscribe. |
| `VAPID_PRIVATE_KEY` | yes | Signs the push requests. |
| `VAPID_SUBJECT` | no | `mailto:` contact, has a default. |
| `ALLOWED_EMAILS` | no | Comma-separated sign-in allow list. |
| `RESEND_API_KEY` | no | Sends the one-time code by email. |

The session TTL is long on purpose. A notification carries answer buttons that
post from the service worker, and a dead session turns a tap into a trip through
the sign-in page.

## Upgrading

```bash
git pull
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply agent-dash --remote
pnpm build && pnpm exec wrangler deploy
```

Or push a `v*` tag and let `.github/workflows/release.yml` do it, which needs
the repository secret `CLOUDFLARE_API_TOKEN` and the variable
`CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts Edit, D1 Edit, Workers
KV Storage Edit, Account Settings Read and User Details Read.

## Troubleshooting

**No notification arrives.** Check Settings in the app: the subscription must
say it is on. A push is only sent for priority 1 and 2; priority 0 shows in the
app only. Quiet hours suppress everything except priority 2.

**The code never appears.** With no `RESEND_API_KEY` the code goes to the Worker
log, so `pnpm exec wrangler tail` has to be running when you request it.

**A notification button does nothing.** The session on that device expired or
was signed out. Tapping the button now opens the sign-in page and returns to the
question afterwards.

**Push stops after re-running `pnpm setup --rotate`.** New VAPID keys invalidate
every existing subscription. Turn notifications off and on again in Settings on
each device.
