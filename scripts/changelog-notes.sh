#!/usr/bin/env bash
# Print the CHANGELOG.md body for one version, without its own heading.
#
#   scripts/changelog-notes.sh 0.2.0  > notes.md
#   scripts/changelog-notes.sh v0.2.0             # a leading v is fine
set -euo pipefail

version="${1:?usage: changelog-notes.sh <version> [changelog]}"
version="${version#v}"
changelog="${2:-CHANGELOG.md}"

notes="$(
  awk -v want="## [$version]" '
    index($0, want) == 1 { collecting = 1; next }
    collecting && /^## / { exit }
    collecting { lines[++n] = $0; if (NF) last = n }
    END { for (i = 1; i <= last; i++) print lines[i] }
  ' "$changelog" | sed -e '/./,$!d'
)"

if [ -z "$notes" ]; then
  echo "changelog-notes: no '## [$version]' section in $changelog." >&2
  exit 1
fi

printf '%s\n' "$notes"
