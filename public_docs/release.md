# Releasing

A release is a git tag. Everything after the tag is automatic.

```bash
git switch main && git pull
./scripts/release.sh 1.2.0
```

The script refuses to run anywhere but a clean `main`, and refuses a version
that already has a tag. It then:

1. writes the version into `package.json` and `cli/package.json`, which track
   the same number;
2. closes the `## [Unreleased]` section of `CHANGELOG.md` as
   `## [1.2.0] - <today>` and opens a fresh empty `Unreleased` above it;
3. commits `chore(release): v1.2.0`, tags `v1.2.0`, and pushes both.

So write the changelog entry before you release, not after: the script only
moves the heading.

## What the tag triggers

`.github/workflows/release.yml` runs on any `v*` tag:

- **verify**: `pnpm typecheck`, `pnpm test`, `pnpm build` on Node 22.
- **deploy**, after verify: applies the D1 migrations, deploys the Worker, then
  creates the GitHub Release with the notes that
  `scripts/changelog-notes.sh` extracts from `CHANGELOG.md` for that version.
- **publish-cli**, after verify: publishes `cli/` to npm, but only when
  an `NPM_TOKEN` secret exists. See below.

Watch it with `gh run watch`.

The deploy job needs two repository settings:

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Workers Scripts Edit, D1 Edit, Workers KV Storage Edit, Account Settings Read, User Details Read |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | the account that owns the Worker |

Worker secrets are never set by CI. They are set once per Worker with
`wrangler secret put`; see [deploy.md](deploy.md).

The D1 database is addressed by the name `agent-dash` in the migration step.
D1 cannot rename a database, so that name outlives the app's name and is only
a label.

## The npm job

`publish-cli` looks for an `NPM_TOKEN` secret first. Without one it prints that
it is skipping and exits successfully, so the release still deploys and still
cuts a GitHub Release. This repository has no npm account attached, so the job
is a no-op today and the CLI is distributed from the release tarball instead.

To turn it on: publish the first version by hand (`cd cli && npm publish
--access public`), then either add an `NPM_TOKEN` repository secret, or
configure the package on npmjs.com with GitHub Actions as a trusted publisher
for this repository and the `release.yml` workflow. The job already requests
`id-token: write` and publishes with `--provenance`, and it fails the release
if `cli/package.json` disagrees with the tag.

## The AUR package

`agent-pwa-notifications` on the AUR builds the CLI from the GitHub release
tarball of the matching tag, so it needs no npm. It installs the CLI under
`/usr/lib/agent-pwa-notifications` and symlinks `/usr/bin/agent-notify-pwa`.

After a release, the package needs a new `pkgver` and a new `sha256sums` entry
for the new tarball, then a rebuild and a push. The tarball is
`https://github.com/Qu4tro/agent-pwa-notifications/archive/refs/tags/v<version>.tar.gz`.

## Versions

Semantic versioning. The hub, the CLI and the tag always carry the same
number, which is what `GET /api/v1/config` reports and what the app shows in
Settings, so a screenshot is enough to tell what is deployed.

## If a release goes wrong

The tag is the only trigger, and the Worker keeps serving the previous
deployment until a new one succeeds.

```bash
pnpm exec wrangler deployments list        # what is live
pnpm exec wrangler rollback <deployment>   # back to the previous one
```

A migration is not rolled back by that. Migrations are additive by convention:
add a column or a table, do not drop or rewrite one, so an older Worker keeps
running against a newer schema.

To retry a tag that failed before it deployed, delete it locally and remotely
(`git tag -d v1.2.0 && git push origin :refs/tags/v1.2.0`), fix the cause, and
run the script again. Do not move a tag that already produced a release.
