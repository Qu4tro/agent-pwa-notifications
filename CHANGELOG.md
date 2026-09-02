# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`scripts/release.sh <version>` turns the `Unreleased` section below into a
released section and opens a fresh empty one.

## [Unreleased]

## [0.3.0] - 2026-09-02

### Added

- Agent-key login links. `POST /api/v1/login-link` (bearer) mints a one-time
  URL that signs a browser in, and `POST /api/auth/link` trades the token for a
  session. `agent-notify-pwa open` prints the URL with a QR. A hub with no email
  sender no longer needs one to sign in a second device.
- `ALLOWED_EMAILS`, an optional Worker secret holding a comma-separated allow
  list of sign-in addresses. Unlisted addresses get the same responses as any
  other failure, so the list cannot be enumerated.
- `public_docs/deploy.md` and `public_docs/notifications.md`.

### Changed

- Clear with scope `read` now means "seen or settled": it also removes questions
  that are answered or expired, whether or not they were ever marked read. It
  still keeps unread updates and questions still waiting on you.
- A thread marks its unread events read on every load, not only the first, so an
  update that arrives while the thread is open does not stay unread for ever.
- Answering a question is now conditional on it still being pending. Two
  concurrent answers give one 200 and one 409, and the stored answer is the
  winner's.
- Notification actions: if every answer fits the browser's slots, only the
  answers show. A "More" button appears only when the answers do not all fit.
- A quick answer that gets a 401 opens `/login?next=/event/<id>` instead of
  bouncing through the thread and losing the question.
- Event retention defaults to 90 days and sessions to 365. Both are vars in
  `wrangler.jsonc`.
- The MCP handshake reports `agent-pwa-notifications` at the running build
  version, and the OpenAPI document covers the update, clear and login-link
  endpoints.
- The skill moved to `skills/agent-notifications/` and was rewritten from the
  endpoints the server actually implements. It no longer describes plan tiers,
  capability negotiation, artifact uploads, a reply channel or a `stale` status,
  none of which exist here. `references/rich-blocks.md` is replaced by
  `references/blocks.md`, which documents the ten real block types.
- The CLI is the package `agent-pwa-notifications` with the binary
  `agent-notify-pwa`. Config moved to `~/.config/agent-notify-pwa/config.json`
  and is copied from the old path on first run. Environment variables are
  `AGENT_NOTIFY_PWA_URL`, `AGENT_NOTIFY_PWA_KEY` and `AGENT_NOTIFY_PWA_ENC_KEY`.
  There is no default hub URL. New: `open` and `status --json`.
- `scripts/setup.mjs` no longer generates the unused legacy `AGENT_KEY`, and
  prints how to read the first one-time code instead of a link that did nothing.
  `scripts/demo.mjs` reads the CLI config.

### Removed

- `scripts/login.mjs` and the `pnpm run login` script. They printed a magic link
  that no route has handled since the one-time-code migration. The CLI `open`
  command replaces them.

## [0.2.0] - 2026-09-01

The first release of the fork. No behaviour change beyond the new version field.

### Added

- Answer micro-questions straight from a push notification. A question whose
  blocks are a single buttons block with two or three short options renders
  those options as notification actions; tapping one posts the answer without
  opening the app.
- A test harness: vitest 4 with `@cloudflare/vitest-pool-workers` for API
  integration tests against real workerd, D1 and KV, plus plain node tests for
  pure functions. The suite covers the quick-answer rules, the service worker
  action rule, bearer and session auth, account isolation, and the three
  clear-scope cases.
- CI on every pull request and on every push to `main`: typecheck, test and
  build on Node 22.
- A release pipeline. `scripts/release.sh <version>` bumps the version, closes
  the changelog section, commits, tags and pushes. The `v*` tag runs
  `.github/workflows/release.yml`, which verifies, applies the D1 migrations,
  deploys the Worker and creates the GitHub Release from the changelog section.
- `/api/v1/config` reports the running version, and the settings page shows it
  in the footer. The root `package.json` version is the single source.

### Changed

- API routing moved out of `src/worker.ts` into `src/server/router.ts` as
  `handleApi(request, env, ctx)`, which returns a `Response` or `null`.
  `src/worker.ts` is now a thin shell that falls through to the TanStack Start
  SSR entry, so tests can exercise the API without a Vite build.
- `quickAnswerActions` and `previewText` moved to `src/server/quick-answers.ts`.
- The toolchain is pinned to Node `>=22.12` and pnpm 11.3.0 through
  `packageManager`, `engines` and `.nvmrc`.
