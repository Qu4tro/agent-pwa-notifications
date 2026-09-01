#!/usr/bin/env bash
# Cut a release: set the version, close the changelog section, commit, tag and
# push. The tag is what triggers .github/workflows/release.yml, which verifies,
# migrates, deploys and creates the GitHub Release.
#
#   ./scripts/release.sh 0.2.0
set -euo pipefail

version="${1:?usage: release.sh <version>   e.g. ./scripts/release.sh 0.2.0}"
version="${version#v}"
tag="v$version"

if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "release: '$version' is not a semantic version." >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "release: on branch '$branch'; releases are cut from main." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "release: the working tree is dirty. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "release: tag $tag already exists." >&2
  exit 1
fi

if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "release: CHANGELOG.md has no '## [Unreleased]' section." >&2
  exit 1
fi

echo "release: preparing $tag"

# 1. Version in both manifests. The CLI package tracks the root version.
node - "$version" <<'NODE'
const fs = require('node:fs')
const version = process.argv[2]
for (const file of ['package.json', 'cli/package.json']) {
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  const next = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`)
  if (next === text) throw new Error(`release: no version field in ${file}`)
  fs.writeFileSync(file, next)
  console.log(`release: ${file} -> ${version}`)
}
NODE

# 2. Close the Unreleased section and open a fresh empty one above it.
today="$(date -u +%Y-%m-%d)"
node - "$version" "$today" <<'NODE'
const fs = require('node:fs')
const [version, today] = process.argv.slice(2)
const text = fs.readFileSync('CHANGELOG.md', 'utf8')
const next = text.replace(
  /^## \[Unreleased\].*$/m,
  `## [Unreleased]\n\n## [${version}] - ${today}`,
)
fs.writeFileSync('CHANGELOG.md', next)
console.log(`release: CHANGELOG.md -> [${version}] - ${today}`)
NODE

# 3. Commit, tag, push.
git add package.json CHANGELOG.md
if [ -f cli/package.json ]; then git add cli/package.json; fi
git commit -m "chore(release): $tag"
git tag -a "$tag" -m "$tag"
git push origin main
git push origin "$tag"

echo "release: pushed $tag. Watch the deploy with: gh run watch"
