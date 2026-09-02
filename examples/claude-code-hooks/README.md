# Claude Code hooks to your notification hub

Two things, both driven by Claude Code hooks (no MCP, just shell):

1. **Push notifications**: get pinged on your phone when the agent **starts**,
   **needs input**, or **finishes** (the finish card is tappable and carries a
   summary of what it just did).
2. **Ask and wait, deterministically**: when the agent needs a decision from you, it
   asks on your phone and **waits for your answer**, then continues with it,
   whether or not the model remembered to poll. The Stop hook handles the
   posting, polling, and feeding your answer back.

## Setup

1. Make the scripts executable:
   ```bash
   chmod +x notify.sh ask.sh
   ```

2. `ask.sh` needs [`jq`](https://jqlang.github.io/jq/) and `curl`. Export your
   hub credentials (add to `~/.zshrc` / `~/.bashrc` to persist):
   ```bash
   export AGENT_NOTIFY_PWA_URL="https://<your-worker>.workers.dev"
   export AGENT_NOTIFY_PWA_KEY="ad_live_..."   # Settings, "Agent key"
   ```

3. Merge the `hooks` block from `settings.json` into your Claude Code
   `settings.json` (user-level `~/.claude/settings.json`, or project
   `.claude/settings.json`). Fix the paths to the two scripts.

4. **Teach Claude the ask convention.** Add this to your `~/.claude/CLAUDE.md`
   (or a project `CLAUDE.md`):

   > When you need a decision, approval, or missing detail from me, end your
   > message with a line:
   > `::ASK_HUMAN:: <your question>`
   > and, if it's a choice, a second line:
   > `::ASK_OPTIONS:: Option A | Option B | Option C`
   > Then stop. I'll answer on my phone and you'll get my reply back.

That's it.

## How it works

| Event | Hook | Behavior |
|-------|------|----------|
| SessionStart | `notify.sh` | Quiet "Session started" one-liner. |
| Notification | `notify.sh` | Priority-2 push when Claude needs permission / goes idle. |
| Stop | `ask.sh` | If the message has `::ASK_HUMAN::` the hook posts the question, poll until you answer, feed your answer back so Claude continues. Otherwise a tappable "Claude finished" card carrying the summary. |

The Stop hook receives Claude's final message (`last_assistant_message`) and can
return `{"decision":"block","reason":"<your answer>"}`, which Claude Code feeds
back to the model as a system reminder , which is what makes the answer land
deterministically instead of relying on the model to keep polling.

- **Buttons vs free text:** include `::ASK_OPTIONS::` for tap-to-choose
  buttons; omit it and you get a text box on your phone.
- **Timeout:** the Stop hook is configured with `timeout: 600` (10 minutes) and
  `ask.sh` polls for ~9 of those. If you don't answer in time, the question stays
  open in the app and Claude is told to proceed with a sensible default.

## Notes & footguns

- **The sentinel is the gate.** The Stop hook fires on every turn end, but it
  only asks-and-waits when your message contains `::ASK_HUMAN::`. Without it,
  a turn just posts the finish card and never blocks. This is deliberate: you do
  **not** want every completion to hang waiting for a phone tap.
- Fails safe: missing credentials, no network or no `jq` and the hook exits quietly, letting
  Claude stop normally. It never wedges your session.
- While `ask.sh` is polling, that Claude Code turn is paused (as intended).
- This is the deterministic, tool-specific path. Any other agent can use
  the portable [skill](../../skills/agent-notifications/SKILL.md) instead (it posts and
  polls from inside the model's own loop). See the skill for the full block
  schema.
