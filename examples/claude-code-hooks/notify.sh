#!/usr/bin/env bash
# Post an event to your Agent PWA Notifications hub from a hook.
# Reads the hook JSON payload on stdin, and the hub URL and account key from
# AGENT_NOTIFY_PWA_URL and AGENT_NOTIFY_PWA_KEY.
#
# Usage (from a hook command):
#   notify.sh "<title>" <priority> "<kind>"
#
# Requires: curl, and (optional) jq for richer titles. Fails silently so a hook
# never blocks your session.

set -euo pipefail

TITLE="${1:-Agent}"
PRIORITY="${2:-0}"
KIND="${3:-update}"

: "${AGENT_NOTIFY_PWA_URL:?set AGENT_NOTIFY_PWA_URL}" 2>/dev/null || exit 0
: "${AGENT_NOTIFY_PWA_KEY:?set AGENT_NOTIFY_PWA_KEY}" 2>/dev/null || exit 0

# Try to pull the working directory / session id out of the hook payload for context.
PAYLOAD="$(cat 2>/dev/null || true)"
CWD=""
if command -v jq >/dev/null 2>&1 && [ -n "$PAYLOAD" ]; then
  CWD="$(printf '%s' "$PAYLOAD" | jq -r '.cwd // .transcript_path // empty' 2>/dev/null || true)"
fi

BLOCKS='[]'
if [ -n "$CWD" ]; then
  BLOCKS="$(printf '[{"type":"keyvalue","items":[{"k":"Where","v":"%s"}]}]' "$(basename "$CWD")")"
fi

curl -sS -m 8 -X POST "$AGENT_NOTIFY_PWA_URL/api/v1/events" \
  -H "Authorization: Bearer $AGENT_NOTIFY_PWA_KEY" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"agent":"hook","task_id":"%s","title":"%s","priority":%s,"kind":"%s","blocks":%s}' \
        "$(basename "${CWD:-session}")" "$TITLE" "$PRIORITY" "$KIND" "$BLOCKS")" \
  >/dev/null 2>&1 || true
