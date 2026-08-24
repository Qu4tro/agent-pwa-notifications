---
name: agent-dash
description: Connect a workspace to Agent Dash, send progress updates that land as phone notifications, and ask a question then WAIT for the human's answer. Use when pairing a project, reaching a milestone or error, or reaching a decision point where the human needs to choose, approve, or provide details.
license: MIT
---

# Agent Dash

Agent Dash is the human's personal notification hub. You talk to it over plain
HTTP with a bearer token. You can **notify**, **ask and wait**, deliver an
**artifact or static preview**, and poll for an ordinary human reply.

## Configuration

You need two values:

- `AGENT_DASH_URL` — the hub. **Defaults to `https://agentdash.mycli.tools`**
  (the hosted service). Only differs if the human self-hosts.
- `AGENT_KEY` — the human's personal bearer token (looks like `ad_live_…`).

Every request sends `Authorization: Bearer <AGENT_KEY>`.

**If you don't have an `AGENT_KEY` yet, get the human to fetch one — say:**

> Go to **https://agentdash.mycli.tools**, sign in with your email (you'll get a
> one-time code), then copy your agent key and paste it here. First time? That
> same step creates your account.

Then use the key they paste. If they self-host, also ask for their hub URL.
Store the key for the rest of the session; you don't need to ask again.

For an MCP-capable agent, make sure the workspace has a project-local
`.mcp.json` entry so the hub's tools can be discovered:

```json
{
  "mcpServers": {
    "agent-dash": {
      "url": "https://agentdash.mycli.tools/mcp",
      "headers": { "Authorization": "Bearer <AGENT_KEY>" }
    }
  }
}
```

This file contains the key, so add `.mcp.json` to `.gitignore` and never commit
it. If you create or change the entry during a session, tell the human that the
agent may need to reload MCP servers or restart before `connect_project` and
`deliver_artifact` appear.

## Connect this workspace

The portable command is `agentdash connect`. Claude Code also gets
`/agentdash connect`; in Codex, invoke this skill with `connect`.

Before the first question about a project, look for `.agentdm` at the workspace
root. If it exists, read its `project.id` and reuse that id on every Agent Dash
call. If it does not exist, pair the workspace before asking:

1. Inspect enough of the repository to write a one-sentence summary.
2. Collect only useful orientation: project name, HTTP(S) repository URL,
   current branch, up to 8 important technologies, and the current focus.
3. Call the MCP `connect_project` tool. With raw HTTP, use:

```bash
curl -X PUT "$AGENT_DASH_URL/api/v1/projects" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agent Dash",
    "summary": "A mobile inbox where AI coding agents send updates, work, and decisions.",
    "repo_url": "https://github.com/example/agent-dash",
    "branch": "main",
    "stack": ["React", "TypeScript", "Cloudflare Workers"],
    "current_focus": "Freemium onboarding and project context"
  }'
```

`POST` is accepted as a compatibility alias if the agent's HTTP client cannot
send `PUT`. An authenticated `GET /api/v1/projects` can be used to verify that
the registration endpoint is available and inspect the current project list.

4. Save the returned project identity locally:

```json
{
  "version": 1,
  "hub": "https://agentdash.mycli.tools",
  "project": { "id": "prj_01...", "name": "Agent Dash" }
}
```

Keep `.agentdm` git-ignored. It may contain the non-secret project profile, but
never put `AGENT_KEY`, an encryption key, credentials, local absolute paths, or
other secrets in it. If `.agentdm` already exists, do not create a second
project. Reuse its id; refresh the profile only when the project context has
materially changed. If an API call returns `unknown_project`, reconnect once.
The connect response also includes `capabilities`; check
`capabilities.artifact_delivery` before sending an image or file.

## Threading — the most important habit

The human sees your work grouped as **Project → Task → conversation**. For that
to work, on EVERY call include:

- `project` — what you're building, e.g. `"Weather app"`.
- `project_id` — the stable id from `.agentdm`, when paired.
- `model` — which model you are, e.g. `"claude-opus-4.8"`, `"gpt-5"`.
- `task` — the human-readable sub-task, e.g. `"Adding children mode"`.
- **`task_id`** — a **stable id you generate once when you start a task and reuse
  on every notify/ask for that task.** This is what threads a sequence of
  questions into ONE conversation. Without a shared `task_id`, Q1/Q2/Q3 become
  three separate cards — exactly the clutter to avoid.

Example: building a feature that needs three decisions →
`task_id: "feat-childmode"` on all of: the first update, question 1, question 2,
question 3. They all appear inside one task thread; each new question shows up in
the same place as you answer the previous one.

Rule of thumb:
- **`ask` / `notify` with the same `task_id`** → a new message in the thread (distinct steps).
- **`update` (POST /events/:id)** → change ONE existing message in place (e.g. a progress bar moving 0→100). Don't post a new event for each %.

## 1. Send an update (notification)

```bash
curl -X POST "$AGENT_DASH_URL/api/v1/events" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude-code",
    "project_id": "prj_01...",
    "project": "Agent Dash",
    "task": "Landing page research",
    "model": "claude-opus-4.8",
    "task_id": "landing-redesign",
    "title": "Finished the competitive research",
    "priority": 1,
    "blocks": [
      { "type": "markdown", "text": "## Found 14 competitors\nPricing ranges **$9–$99/mo**." },
      { "type": "progress", "label": "Sources reviewed", "value": 14, "max": 14 }
    ]
  }'
```

- `priority`: `0` silent (shows in app, no push), `1` push, `2` urgent (rings through quiet hours). Default `0`.
- `task_id`: reuse the same string across a run so related updates thread together.
- `kind` is `update` here. Use `"kind":"done"` for a final success, `"kind":"error"` for a failure.

**When to notify:** milestones, not every step. Good: "Scraped all sources",
"Deploy succeeded", "Tests failing — see log". Bad: narrating each file you read.

## 2. Ask a question and wait for the answer

Post a question with an **interactive block** (`buttons` for a choice, `form`
to collect fields). You get back an `id`. Then poll that id until it's answered.

### Post the question

```bash
curl -X POST "$AGENT_DASH_URL/api/v1/questions" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "claude-code",
    "project_id": "prj_01...",
    "project": "Agent Dash",
    "task": "Deck framing",
    "model": "claude-opus-4.8",
    "task_id": "deck-framing",
    "title": "Which audience should the deck target?",
    "timeout_minutes": 120,
    "ack": "Got it — building for {answer}. Watch this thread for updates.",
    "blocks": [
      { "type": "markdown", "text": "Research is done. Pick the framing and I'll draft it." },
      { "type": "form", "id": "deck", "submitLabel": "Build it", "fields": [
        { "id": "audience", "kind": "select", "label": "Audience", "options": ["VC", "Customer", "Internal"] },
        { "id": "tone", "kind": "radio", "label": "Tone", "options": ["Formal", "Punchy"] },
        { "id": "notes", "kind": "textarea", "label": "Anything to emphasize?" }
      ]}
    ]
  }'
# → { "ok": true, "id": "01J...", "poll_url": "/api/v1/questions/01J...", "timeout_at": 1699... }
```

Or a simple choice:

```json
"blocks": [
  { "type": "markdown", "text": "About to deploy to production. Go?" },
  { "type": "buttons", "id": "confirm", "options": ["Deploy", "Cancel"] }
]
```

### Poll for the answer

```bash
curl "$AGENT_DASH_URL/api/v1/questions/01J..." \
  -H "Authorization: Bearer $AGENT_KEY"
# pending:  { "ok": true, "status": "pending",  "answer": null }
# answered: { "ok": true, "status": "answered", "answer": { "deck": { "audience": "VC", "tone": "Punchy", "notes": "Lead with traction" } } }
# expired:  { "ok": true, "status": "expired" }
```

**Polling loop — do exactly this:**

1. Poll the id.
2. If `status` is `pending`, wait ~10 seconds and poll again. After the first
   5 minutes, back off to every ~30 seconds to be kind to the free tier.
3. If `status` is `answered`, read `answer` (keyed by each block `id`) and continue your work using those values.
4. If `status` is `expired`, the human didn't respond in time — proceed with a sensible default and mention that you did.

The `answer` object is keyed by block id. A `buttons` block answers with the
chosen string (`{ "confirm": "Deploy" }`); a `form` block answers with an object
of `{ fieldId: value }`.

**Delivery receipt.** When your poll returns `answered`, the human's screen
automatically flips from "waiting for the agent…" to "agent received it" and
shows your `ack` message. So keep polling promptly after they might answer — the
poll is what confirms receipt to them.

## 3. Wait for an ordinary reply

The human can reply with free text in any task thread. Poll with the same stable
`task_id` used on your messages:

```bash
curl "$AGENT_DASH_URL/api/v1/replies?thread_key=landing-redesign&after=0" \
  -H "Authorization: Bearer $AGENT_KEY"
# { "ok": true, "replies": [{ "id": "...", "body": { "text": "Make the CTA smaller" }, "created_at": 1699... }] }
```

Use the largest `created_at` value as the next `after` cursor. The CLI equivalent
is `agentdash wait --task-id landing-redesign`.

## 4. Bring the work into the thread

Hosted artifacts and static previews are plan-gated. The CLI handles the upload
lifecycle and posts the resulting typed block:

```bash
agentdash artifact ./proposal.pdf --project "Marketing" --task-id proposal
agentdash preview ./dist --project "Website" --task-id landing-redesign
```

If the MCP tool list includes `deliver_artifact`, prefer it for images and files
up to 8 MB: base64-encode the file bytes and call the tool with `name`,
`mime_type`, `content_base64`, `title`, and the usual project/task metadata. It
uploads the content and posts the artifact card in one call. When the human asks
to see an image or file, deliver it this way instead of returning a local path.

Use `artifact` for an image, PDF, document, archive, or other file up to the
configured size limit. Use `preview` only for a built static directory containing
`index.html`. Never send a local-only URL such as `localhost`; package the build
as a preview so the human can open it from another device.

If the hub returns `daily_agent_message_limit`, stop creating new events until
the returned reset time. The human can still read, reply, and approve existing
work. If it returns `monthly_artifact_limit`, send an ordinary link or text update
instead of retrying the upload.

## Blocks reference

Display (any event): `markdown`, `progress`, `keyvalue`, `table`, `link`,
`image`, `code`, `callout`, `artifact`, `preview`. Interactive (questions only):
`buttons`, `form`.

Full machine-readable schema with examples: `GET $AGENT_DASH_URL/api/v1/schema.json`
(no auth needed). Fetch it if you need exact field shapes.

## Keeping the inbox tidy

If you've posted a lot of progress noise and it's getting cluttered, you can
clear items you've already delivered:

```bash
curl -X POST "$AGENT_DASH_URL/api/v1/clear" \
  -H "Authorization: Bearer $AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"scope":"read"}'          # removes only what the human has already seen/answered
```

- `scope: "read"` is safe — it never removes unread items or unanswered questions.
- `scope: "all"` wipes everything (a full restart) — only do this if the human asked.
- Add `"project": "Weather app"` to limit clearing to one project.

## Attribution — always include these

So the human can tell agents/tasks apart at a glance, include on every call:

- `project` — what you're working on, e.g. `"Weather app"`.
- `model` — which model you are, e.g. `"claude-opus-4.8"`, `"gpt-5"`.
- `task` — the current sub-task, e.g. `"Adding children mode"`.
- `tags` — optional, e.g. `["ui","backend"]`.

## Prompting the human to log in

To answer your questions the human must be logged into Agent Dash on their
phone. If they may not be, tell them:

> Open your Agent Dash hub URL (`AGENT_DASH_URL`) on your phone, enter your
> email, and type the one-time code we send you. Then answer there.

Login is email → one-time code (no app, no password). The same page is where a
new user gets their `AGENT_KEY` (shown once). If the human hasn't given you a
hub URL yet, ask for it once.

## Etiquette

- Notify on milestones and completions, ask only at real decision points.
- Set `priority: 2` only for things that should interrupt the human.
- Reuse one `task_id` per run so the human sees a clean thread, not noise.
- Don't block forever: always pass a `timeout_minutes` on questions and handle `expired`.
