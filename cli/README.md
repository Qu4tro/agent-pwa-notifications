# agent-pwa-notifications (CLI)

Talk to your own Agent PWA Notifications hub from a shell: connect an agent, mint a
one-time sign-in link for your phone, send updates, and ask a question and wait
for the answer.

The binary is `agent-notify-pwa`.

```bash
agent-notify-pwa login          # save and verify your hub URL and account key
agent-notify-pwa connect        # write ./.mcp.json so an MCP client can call the hub
agent-notify-pwa open           # one-time sign-in link, with a QR to scan
agent-notify-pwa notify "Deploy finished" --priority 1 --project "API"
agent-notify-pwa ask "Ship it?" --button Ship --button Hold
agent-notify-pwa status --json
```

There is no default hub URL: every hub is somebody's own deployment. `login`
asks for yours and saves it to `~/.config/agent-notify-pwa/config.json` (XDG
respected). If you used the older CLI, its config is copied over on first run.

Resolution order for every value: flags, then environment, then the saved
config.

| Value | Flag | Environment |
|---|---|---|
| Hub URL | `--url` | `AGENT_NOTIFY_PWA_URL` |
| Account key | `--key` | `AGENT_NOTIFY_PWA_KEY` |
| Encryption key | `--enc-key` | `AGENT_NOTIFY_PWA_ENC_KEY` |

## Commands

### login

```bash
agent-notify-pwa login --url https://notifications.example.workers.dev --key ad_live_...
```

Verifies the pair against the hub before saving it. Get the account key from
Settings in the app.

### connect

Adds an `agent-notifications` entry to `./.mcp.json`, keeping any other servers
already in the file. That file holds your key, so keep it out of git.

### open

```bash
agent-notify-pwa open                      # URL plus a QR code
agent-notify-pwa open --no-qr              # URL only
agent-notify-pwa open --next /settings     # land somewhere other than the inbox
agent-notify-pwa open --ttl 60             # 1 to 60 minutes, default 15
```

Mints a one-time link that signs a browser in. Scan it on the phone; do not
open it on the machine that printed it, because the link works exactly once.
Ten links an hour per account.

### notify

```bash
agent-notify-pwa notify "Tests failing" --kind error --priority 2 \
  --project "API" --task "CI" --task-id ci-run-4821 \
  --markdown "3 of 412 specs failed. See the log."
```

`--priority`: `0` silent, `1` push, `2` urgent (rings through quiet hours).
`--kind`: `update`, `done` or `error`. Reuse one `--task-id` across a run so the
messages thread together.

The human can change an answer after giving it. A change rides on the next
`notify`, `ask` or `update` you make on the same `--task-id`, and prints on
stderr, one line each, until you poll the question again:

```
changed answer 01J9... "Ready to deploy?": {"answer":{"choice":"Hold"},"text":"wait for QA"}
```

`--kind done` is what moves the thread out of Active on the dashboard; `error`
does not, because an agent that hit an error may still retry. If nothing says
`done`, the thread finishes on its own after `--idle` minutes of silence
(default 240). Raise it when you are about to go quiet for longer:

```bash
agent-notify-pwa notify "Running the full suite, back in a while" \
  --task-id ci-run-4821 --idle 720
```

### ask

```bash
agent-notify-pwa ask "Ready to deploy?" --button Deploy --button Hold \
  --project "API" --task-id deploy-check --ack "Going with {answer}."
```

Posts the question, then polls until it is answered or expires. The answer JSON
goes to stdout and the progress dots to stderr, so this composes:

```bash
CHOICE=$(agent-notify-pwa ask "Ship it?" --button Ship --button Hold | jq -r .choice)
```

The answer is one object of two fields:

```json
{ "choice": "Ship", "text": "after the demo, not before" }
```

Every question also takes the human's own words, so `text` may carry the whole
answer and `choice` be null. Read both:

```bash
ANSWER=$(agent-notify-pwa ask "Ship it?" --button Ship --button Hold)
CHOICE=$(jq -r .choice <<<"$ANSWER")   # null when they only wrote words
NOTE=$(jq -r .text <<<"$ANSWER")       # null when they only tapped
```

Two or three buttons of at most 20 characters, with a title of at most 80
characters, make the question answerable straight from the notification. A
question with more options, or a form, still takes words there: the
notification carries a Reply action on a browser that types into one.

Answers colour themselves. A plain affirmative or denial comes out green or
red, and anything else takes its own colour from a palette, so two choices are
told apart before they are read:

```bash
agent-notify-pwa ask "Promote build 4821?" --button Yes --button No
```

`--color` overrides that, always, and pairs with `--button` by position from
the left. Use it when a particular choice should read a particular way:

```bash
agent-notify-pwa ask "Roll the flag?" --button "Roll it" --button Wait \
  --color mint --color amber
```

The values are `blue`, `violet`, `mint`, `rose`, `amber`, `cyan`, `pink`,
`lime`, or `#rrggbb`. Pass fewer `--color`s than `--button`s and the options
past the end colour themselves; because the pairing is positional, colouring
only the second button means giving the first one a value too.

Because `--color` wins over the affirmative/denial rule, it is also the only
way to paint a "Yes" red. Do not: red is the error colour everywhere else in
the app.

### status

```bash
agent-notify-pwa status
agent-notify-pwa status --json   # { "url": "...", "key": "...", "encKey": false }
```

## End-to-end encryption

With an encryption key set, block content is encrypted before it leaves this
machine and the hub only stores ciphertext.

```bash
agent-notify-pwa login --url ... --key ... --enc-key <ENC_KEY>
agent-notify-pwa notify "Secret result" --markdown "sensitive" --e2e
```

Set the same key in the app under Settings, Encryption. The server cannot read
encrypted blocks, so encrypted questions never get notification answer buttons.

## Install

Run it straight from a checkout of the hub repository:

```bash
node cli/bin.mjs <command>
```

On Arch Linux, install the AUR package `agent-pwa-notifications`, which puts
`agent-notify-pwa` on the PATH. It builds from the GitHub release tarball.

The only dependency is `qrcode-terminal`. Needs Node 20 or newer.
