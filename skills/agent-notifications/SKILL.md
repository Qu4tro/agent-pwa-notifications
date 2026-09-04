---
name: agent-notifications
description: Send an update to the human's phone, or ask them a question and wait for the answer, through a self-hosted Agent Notifications hub. Use when reaching a milestone, finishing or failing a task, or needing a decision, an approval or a missing detail.
license: MIT
---

# Agent Notifications

Agent Notifications is the human's own push inbox, self-hosted on Cloudflare
Workers. You talk to it over plain HTTP with a bearer token. You can send an
update, change an update in place, and ask a question and wait for the answer.

Everything in this document is an endpoint the hub really implements. There is
no paid tier, no negotiation step before you send, and no file upload. Every
question also takes the human's own words, which arrive as `text` beside the
values they chose. If you need the machine-readable contract, fetch
`GET <hub>/api/v1/schema.json` (blocks) or `GET <hub>/api/v1/openapi.json`
(endpoints). Neither needs auth.

## Configuration

You need two values:

- the hub URL, e.g. `https://notifications.example.workers.dev`. There is no
  default: every hub is somebody's own deployment.
- the account key, a bearer token that looks like `ad_live_...`.

Get both from the CLI, which is the normal case:

```bash
agent-notify-pwa status --json
# { "url": "https://notifications.example.workers.dev", "key": "ad_live_...", "encKey": false }
```

Or read them from the environment: `AGENT_NOTIFY_PWA_URL` and
`AGENT_NOTIFY_PWA_KEY`. The examples below use `$HUB` and `$KEY` for the two.

If neither is available, ask the human once for their hub URL and their account
key (Settings, "Agent key"), then keep both for the rest of the session.

For an MCP-capable agent, `agent-notify-pwa connect` writes a project-local
`.mcp.json`:

```json
{
  "mcpServers": {
    "agent-notifications": {
      "url": "https://notifications.example.workers.dev/mcp",
      "headers": { "Authorization": "Bearer ad_live_..." }
    }
  }
}
```

That file holds the key. Add `.mcp.json` to `.gitignore` and never commit it.
The MCP server has five tools: `notify`, `update`, `ask`, `wait_for_answer` and
`clear`. They map one to one onto the endpoints below.

## Threading: the most important habit

The human sees the work grouped as project, then task, then a conversation. For
that, send on every call:

- `project`: what you are building, e.g. `"Weather app"`.
- `task`: the human-readable sub-task, e.g. `"Adding children mode"`.
- `model`: which model you are, e.g. `"opus-4.8"`, `"gpt-5"`.
- `task_id`: a stable id you generate once when you start a task and reuse on
  every call for that task. This is what threads a sequence of updates and
  questions into ONE conversation. Without a shared `task_id`, three questions
  become three separate cards, which is exactly the clutter to avoid.
- `tags`: optional, e.g. `["ui", "backend"]`.

Rule of thumb:

- `notify` or `ask` with the same `task_id`: a new message in the thread.
- `update` (POST /api/v1/events/:id): change ONE existing message in place, for
  example a progress bar moving 0 to 100. Do not post a new event per percent.

## 1. Send an update

CLI:

```bash
agent-notify-pwa notify "Finished the competitive research" \
  --project "Weather app" --task "Landing page research" \
  --model "opus-4.8" --task-id landing-redesign --priority 1 \
  --markdown "Found 14 competitors. Pricing ranges 9 to 99 a month."
```

Raw HTTP:

```bash
curl -X POST "$HUB/api/v1/events" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "cli-agent",
    "project": "Weather app",
    "task": "Landing page research",
    "model": "opus-4.8",
    "task_id": "landing-redesign",
    "title": "Finished the competitive research",
    "priority": 1,
    "blocks": [
      { "type": "markdown", "text": "## Found 14 competitors\nPricing ranges 9 to 99 a month." },
      { "type": "progress", "label": "Sources reviewed", "value": 14, "max": 14 }
    ]
  }'
# -> { "ok": true, "id": "01J..." }
```

- `priority`: `0` silent (shows in the app, no push), `1` push, `2` urgent
  (rings through quiet hours). Default `0`.
- `kind`: `update` (default), `done` for a final success, `error` for a failure.
- `idle_minutes`: how long silence still counts as working. Default `240`.
- Keep the returned `id` if you plan to update the event in place.

### Saying when a task is over

The human's dashboard sorts a thread into Needs you, Active or Done. Only two
things move a thread into Done, and neither of them is the human reading it:

- You send `kind: "done"`. Send it on the last message of every task. An
  `error` does **not** end a thread, because an agent that hit an error may
  still retry - follow the error with a `done` when you finally stop.
- Or the thread goes quiet for longer than `idle_minutes` (default `240`, four
  hours). This is the safety net for an agent that crashes or is killed, not a
  substitute for saying `done`.

Set `idle_minutes` on any event when you are about to go quiet for longer than
four hours; the latest value on the thread wins.

```bash
curl -X POST "$HUB/api/v1/events" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "task_id": "landing-redesign", "title": "Landing page shipped",
        "kind": "done", "priority": 1 }'
```

When to notify: milestones, not every step. Good: "Scraped all sources",
"Deploy succeeded", "Tests failing, see the log". Bad: narrating each file you
read.

## 2. Update an event in place

Use this for live progress. The card moves; no new row appears.

```bash
curl -X POST "$HUB/api/v1/events/01J..." \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Scan complete",
    "kind": "done",
    "notify": true,
    "blocks": [{ "type": "progress", "label": "Sources", "value": 100, "max": 100 }]
  }'
```

- `blocks` replaces the old blocks entirely.
- `notify` defaults to `false`. Leave it off for silent progress ticks and set
  it on the final call.
- Questions cannot be updated in place.

## 3. Ask a question and wait

CLI, which posts the question and blocks until the answer arrives:

```bash
agent-notify-pwa ask "Ready to deploy?" --button Deploy --button Hold \
  --project "Weather app" --task-id deploy-check
# prints the answer JSON on stdout: {"choice":"Deploy"}
```

Raw HTTP:

```bash
curl -X POST "$HUB/api/v1/questions" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "cli-agent",
    "project": "Weather app",
    "task": "Deploying",
    "model": "opus-4.8",
    "task_id": "deploy-check",
    "title": "Ready to deploy?",
    "timeout_minutes": 120,
    "ack": "Got it, going with {answer}. Watch this thread.",
    "blocks": [
      { "type": "markdown", "text": "All production checks passed." },
      { "type": "buttons", "id": "confirm", "options": ["Deploy", "Hold"] }
    ]
  }'
# -> { "ok": true, "id": "01J...", "poll_url": "/api/v1/questions/01J...", "timeout_at": 1699... }
```

A question must carry at least one interactive block (`buttons` or `form`).
`timeout_minutes` defaults to 1440 (24 hours) and caps at 10080 (7 days).
`ack` is shown to the human the moment they answer; `{answer}` is replaced with
their choice.

Then poll:

```bash
curl "$HUB/api/v1/questions/01J..." -H "Authorization: Bearer $KEY"
# pending:  { "ok": true, "status": "pending",  "answer": null, "text": null }
# answered: { "ok": true, "status": "answered", "answer": { "confirm": "Deploy" }, "text": null, "answered_at": 1699..., "changes": 0 }
# words:    { "ok": true, "status": "answered", "answer": {}, "text": "wait for QA to sign off", "answered_at": 1699..., "changes": 0 }
# expired:  { "ok": true, "status": "expired" }
```

The polling loop, exactly:

1. Poll the id.
2. `pending`: wait about 10 seconds and poll again.
3. `answered`: read both parts and carry on with them. `answer` holds the
   values, keyed by each block id - a `buttons` block answers with the chosen
   string, a `form` block with an object of `{ fieldId: value }` - and is `{}`
   when the human only wrote words. `text` holds the human's own words, and is
   `null` when they only used the controls.
4. `expired`: the human did not answer in time. Proceed with a sensible default
   and say that you did.

There are only those three states. There is no close or cancel endpoint: a
question you abandon simply expires at `timeout_at`.

The first poll that returns `answered` also flips the human's screen from
"waiting for the agent" to "agent received it". So keep polling promptly after
they might have answered; the poll is what confirms receipt to them. A change
resets that screen, and the next poll flips it again.

## When the human changes an answer

The latest answer is the answer. The human can replace one after giving it, and
`changes` counts the replacements: a number higher than the one you last saw
means what you are holding is out of date. A change also clears the delivery
receipt, so their screen waits on you again until you poll.

An agent that has moved on has no poll running, so a change rides on the next
call you make on the same thread. `POST /api/v1/events`,
`POST /api/v1/events/{id}` and `POST /api/v1/questions` answer with
`changed_answers` when there is one, and leave the field out when there is not:

```json
{
  "ok": true,
  "id": "01J...",
  "changed_answers": [
    {
      "id": "01J...",
      "title": "Ready to deploy?",
      "answer": { "confirm": "Hold" },
      "text": "wait for QA to sign off",
      "answered_at": 1699,
      "changes": 1
    }
  ]
}
```

What to do: read each item before going on, then poll its id. The poll is the
acknowledgement, and the item stops appearing. Scoping is by `task_id`, so a
call without one carries nothing.

## Micro-questions: answerable from the notification itself

The human can answer straight from the push notification, without opening the
app, when ALL of these hold:

- `title` is at most 80 characters.
- the blocks contain exactly one interactive block, and it is `buttons`.
- that block has 2 or 3 options (2 is better).
- each option is at most 20 characters, with no leading or trailing space.
- the question is not encrypted.

Anything else stays tap-to-open, which is fine but slower for the human. Never
shorten a choice until its meaning goes fuzzy; put the context in a `markdown`
block instead, which the notification body previews and the thread shows in
full.

How many buttons actually appear depends on the browser. Firefox on the desktop
shows several, Chrome on Android shows two, and Safari on iOS shows none. When
the answers do not all fit, the notification shows as many as fit beside a
Reply action, which takes the human's own words.

Reply takes a slot whenever one is free, so a yes/no question on Android shows
the two options and nothing else, while a form question or a long one shows
Reply on its own. Write the question so that opening the thread is never a
failure.

## 4. Keep the inbox tidy

```bash
curl -X POST "$HUB/api/v1/clear" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"scope":"read"}'
# -> { "ok": true, "cleared": 3 }
```

- `scope: "read"` is the safe default. It removes what the human has already
  seen, plus questions that are answered or expired. It never removes an unread
  update or a question still waiting on them.
- `scope: "all"` wipes everything. Only do this when the human asked for it.
- Add `"project": "Weather app"` to limit the clear to one project.

## 5. Get the human signed in

To answer a question the human must be signed in on the device that shows the
notification. If they may not be, mint a one-time link:

```bash
agent-notify-pwa open            # prints the URL and a QR code to scan
agent-notify-pwa open --no-qr    # prints only the URL
```

Raw HTTP:

```bash
curl -X POST "$HUB/api/v1/login-link" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"ttl_minutes":15}'
# -> { "ok": true, "url": "https://.../login?t=...", "expires_at": 1699... }
```

The link works once, expires after `ttl_minutes` (1 to 60, default 15), and is
rate limited to 10 an hour. Send it to the human, do not open it yourself. An
optional `next` (a same-origin path) picks the page they land on.

A hub with an email sender configured also offers sign-in by one-time code, so
the human can always get in without you.

## 6. End-to-end encryption

If the human set an encryption key, block content is encrypted in the browser
and in the CLI, and the hub only ever stores ciphertext. Two consequences:

- The server cannot read the blocks, so it cannot build notification answer
  buttons. Encrypted questions are always tap-to-open.
- The `answer` you poll back is a ciphertext string, not an object. Decrypt it
  with the same key.

Use `--e2e` on the CLI, or send `"enc": true` with `blocks` as the ciphertext
string. Leave encryption off unless the human asked for it.

## Blocks

Ten block types. Display blocks work in any event; `buttons` and `form` are only
valid on a question. Full list with an example each:
[references/blocks.md](references/blocks.md). Machine-readable:
`GET $HUB/api/v1/schema.json`.

## Endpoints

That is the whole API:

| Method | Path | Auth | What |
|---|---|---|---|
| POST | `/api/v1/events` | bearer | Send an update |
| POST | `/api/v1/events/:id` | bearer | Change an update in place |
| POST | `/api/v1/questions` | bearer | Ask a question |
| GET | `/api/v1/questions/:id` | bearer | Poll for the answer |
| GET | `/api/v1/inbox?limit=&agent=` | bearer | Recent events, for dedupe or resume |
| POST | `/api/v1/clear` | bearer | Remove seen, settled, or all events |
| POST | `/api/v1/login-link` | bearer | Mint a one-time sign-in link |
| GET | `/api/v1/schema.json` | none | The block schema |
| GET | `/api/v1/openapi.json` | none | The endpoint spec |
| POST | `/mcp` | bearer | JSON-RPC, the five tools |

## Etiquette

- Notify on milestones and completions. Ask only at real decision points.
- End every task with `kind: "done"`. Without it the thread sits in Active
  until the idle timeout runs out, and the human cannot tell you finished from
  you stopping.
- Use `priority: 2` only for something that should interrupt the human.
- Reuse one `task_id` per task so the human sees a thread, not noise.
- Always pass `timeout_minutes` on a question and handle `expired`.
- Prefer a micro-question: two short buttons the human can tap from the
  notification beats a form they have to open the app for.
- Read `text` even when a control was used. It may qualify the choice, and it
  is where the human says the thing your options had no room for.
- Do not colour the answers. The options already come out in different
  colours, and a plain "Yes"/"No" - or "Correct"/"Wrong", "Approve"/"Reject",
  "Go ahead"/"Not now" - comes out green/red on its own. Write the plain word
  and let it. `colors` on a buttons block overrules that, and is for the rare
  case where one choice should read a particular way; never use it to paint an
  affirmative red.
- Do not block forever. If you stop waiting, say so in a follow-up update on
  the same thread, so the human knows the question no longer matters.

## Updating this skill

When the human invokes `/agent-notifications update`, treat that as permission
to update only this skill. Run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/update-skill.mjs"
```

It detects whether this copy is installed at project or global scope, updates
that copy from `Qu4tro/agent-pwa-notifications`, and verifies the result. Report
the updated scope, then stop. Do not send an event during the update. If the
running session still has the old instructions, tell the human to invoke the
skill again in a new conversation. Do not update any other skill and do not
touch MCP credentials.
