# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`scripts/release.sh <version>` turns the `Unreleased` section below into a
released section and opens a fresh empty one.

## [Unreleased]

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
