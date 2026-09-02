#!/usr/bin/env bash
# Deterministic ask-and-wait, driven by the Stop hook.
#
# Wire this to the Stop event. On every turn end it does one of two things:
#
#   1. If the agent's final message contains a line starting with
#        ::ASK_HUMAN:: <question>
#      (optionally followed by a line  ::ASK_OPTIONS:: A | B | C )
#      then it posts that question to the hub, polls until you answer on your
#      phone, and feeds your answer BACK to the agent so it continues, no matter
#      whether the model "remembered" to poll. That's the deterministic part.
#
#   2. Otherwise (a normal turn end) it pushes a tappable "Agent finished" card
#      carrying the summary of what it just said: a one-liner preview that
#      opens to the full text on your phone.
#
# Requires: curl, jq. Reads AGENT_NOTIFY_PWA_URL / AGENT_NOTIFY_PWA_KEY from env. Fails safe: any
# error just lets the agent stop normally (never wedges your session).

set -uo pipefail

URL="${AGENT_NOTIFY_PWA_URL:-}"
KEY="${AGENT_NOTIFY_PWA_KEY:-}"
[ -z "$URL" ] || [ -z "$KEY" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

PAYLOAD="$(cat 2>/dev/null || true)"
MSG="$(printf '%s' "$PAYLOAD" | jq -r '.last_assistant_message // empty' 2>/dev/null || true)"
CWD="$(printf '%s' "$PAYLOAD" | jq -r '.cwd // empty' 2>/dev/null || true)"
PROJECT="$(basename "${CWD:-session}")"

api() { # api METHOD PATH [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -m 15 -X "$method" "$URL$path" \
      -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null
  else
    curl -sS -m 15 -X "$method" "$URL$path" \
      -H "Authorization: Bearer $KEY" 2>/dev/null
  fi
}

# -- Branch 1: an explicit ask? ---------------------------------------------
QUESTION="$(printf '%s' "$MSG" | sed -n 's/^[[:space:]]*::ASK_HUMAN:://p' | head -1 | sed 's/^[[:space:]]*//')"

if [ -n "$QUESTION" ]; then
  OPTS_LINE="$(printf '%s' "$MSG" | sed -n 's/^[[:space:]]*::ASK_OPTIONS:://p' | head -1)"

  # Build the interactive block: buttons if options were given, else a text form.
  if [ -n "$OPTS_LINE" ]; then
    OPTIONS_JSON="$(printf '%s' "$OPTS_LINE" | tr '|' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | jq -R . | jq -s .)"
    BLOCKS="$(jq -n --arg q "$QUESTION" --argjson opts "$OPTIONS_JSON" \
      '[{type:"markdown",text:$q},{type:"buttons",id:"choice",options:$opts}]')"
    ANSWER_FILTER='.answer.choice // empty'
  else
    BLOCKS="$(jq -n --arg q "$QUESTION" \
      '[{type:"markdown",text:$q},{type:"form",id:"form",submitLabel:"Send",fields:[{id:"reply",kind:"textarea",label:"Your answer"}]}]')"
    ANSWER_FILTER='.answer.form.reply // empty'
  fi

  BODY="$(jq -n --arg agent "hook" --arg tid "$PROJECT" --arg title "$QUESTION" \
    --arg project "$PROJECT" --argjson blocks "$BLOCKS" \
    '{agent:$agent,task_id:$tid,title:$title,project:$project,timeout_minutes:15,blocks:$blocks,
      ack:"Got it, continuing with your answer."}')"

  RESP="$(api POST /api/v1/questions "$BODY")"
  QID="$(printf '%s' "$RESP" | jq -r '.id // empty' 2>/dev/null)"
  if [ -z "$QID" ]; then exit 0; fi  # could not post, so let the turn end

  # Poll until answered/expired. Hook timeout is 600s by default, so stay under
  # it: ~9 minutes, backing off from 4s to 12s.
  ELAPSED=0; DELAY=4
  while [ "$ELAPSED" -lt 540 ]; do
    sleep "$DELAY"; ELAPSED=$((ELAPSED + DELAY))
    [ "$ELAPSED" -ge 60 ] && DELAY=12
    POLL="$(api GET "/api/v1/questions/$QID")"
    STATUS="$(printf '%s' "$POLL" | jq -r '.status // empty' 2>/dev/null)"
    case "$STATUS" in
      answered)
        ANS="$(printf '%s' "$POLL" | jq -r "$ANSWER_FILTER" 2>/dev/null)"
        jq -n --arg a "$ANS" \
          '{decision:"block",reason:("The human answered on their phone: \"" + $a + "\". Continue based on this; do not ask again.")}'
        exit 0 ;;
      expired)
        jq -n '{decision:"block",reason:"The human did not answer in time (question expired). Proceed with a sensible default and note that you did."}'
        exit 0 ;;
    esac
  done
  # Local timeout: leave the question open on the phone and let the turn end.
  jq -n '{decision:"block",reason:"Still waiting on the human (no answer yet). You may stop; the question stays open in the app and can be picked up later."}'
  exit 0
fi

# -- Branch 2: normal turn end, so post a tappable summary card --------------
if [ -n "$MSG" ]; then
  SUMMARY="$(printf '%s' "$MSG" | head -c 1800)"
  BODY="$(jq -n --arg tid "$PROJECT" --arg project "$PROJECT" --arg md "$SUMMARY" \
    '{agent:"hook",task_id:$tid,project:$project,kind:"done",priority:1,
      title:"Agent finished, ready for you",
      blocks:[{type:"markdown",text:$md}]}')"
  api POST /api/v1/events "$BODY" >/dev/null 2>&1 || true
fi
exit 0
