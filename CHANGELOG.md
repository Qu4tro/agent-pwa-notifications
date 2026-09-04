# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`scripts/release.sh <version>` turns the `Unreleased` section below into a
released section and opens a fresh empty one.

## [Unreleased]

### Changed

- A thread's messages all stand shut, the newest one and a waiting question
  too, and a tap opens one over the thread: the blocks, and on a question the
  controls, the answer that stands, "Change answer" and where that answer got
  to. Which message is open is in the address (`?msg=`), so the phone's back
  button closes it and a reload comes back to it. The row is a button: Tab
  reaches it, Enter and Space open it.
- A shut question row says where its question stands, beside the kind word: a
  dot in the state colour and one word - waiting, sent, changed, received or
  expired. The sentence behind the word is the dot's title and its accessible
  name. An update, a done or an error has no standing and gets no dot.
- On a task row's timeline the answer sits against the question it settled,
  after a small arrow and in the title's weight, instead of out at the right
  edge of the line in bold. The same goes for "needs answer" and "expired".
- The eight answer colours are saturated, each a step under the kind colour of
  its family, instead of pale tints; the owner said the tints did not fit the
  theme. The eight names an agent can send are unchanged. Hover doubles the
  outline rather than washing the button in its colour, which at this
  saturation would have taken the label under 4.5:1.
- Table rows in a message band even and odd by where they sit, so the bands
  hold after a sort, and the hairline under every row goes: two ways of saying
  where a row ends is one more than the eye needs.

### Added

- A bare http or https URL in a markdown block or a callout is a link. Trailing
  punctuation and a closing bracket the URL never opened stay outside it; a
  URL inside a code span or already inside a `[label](url)` is left alone. A
  long link wraps instead of widening the page on a phone. Callout text now
  reads the same inline markdown a paragraph does: bold, code and links.

## [1.2.1] - 2026-09-04

### Changed

- The app is called Agent PWA Notifications. The name it had, "Agent
  Notifications", was neither the repository's nor the package's, and the
  installed app on a phone showed a third one - "Agents" - under its icon. One
  name now, on the header, the document title, the login page, the installed
  app, the sign-in email, the CLI and the API docs. The home-screen label is
  "Agent PWA": a launcher truncates at about a dozen characters, so the full
  name would land there as "Agent PWA No...".

### Fixed

- Fenced code inside a `markdown` block renders as code. An agent asked for
  markdown writes a fence into it, because that is what writing markdown means,
  and the fence used to arrive as a paragraph of literal backticks with the
  code under it as prose: no monospace, no highlighting, no copy button, and an
  `{"ok": true}` on the way in that told the agent nothing had gone wrong. A
  fence now renders as the `code` block it is, language and all, with the prose
  around it still markdown. An unclosed fence runs to the end of the message
  rather than dropping the code under it.

## [1.2.0] - 2026-09-04

### Added

- One page for everything waiting on you. `GET /api/v1/pending` gathers every
  unanswered question across every project, longest wait first, and a bell in
  the header carries the count on every page. Answering from it drops the row
  the same way answering from a project does.
- A live mode, at `/pending/live`. One question at a time, full screen, with
  the next card prefetched while the current one is up: answer, watch it
  acknowledge, and the next question is answerable 2.6 seconds later. The
  screen is held awake while the tab is visible, and every animation collapses
  under `prefers-reduced-motion`. Set it as the installed app's start page and
  the phone becomes a queue.
- Free text on every question. A line under the controls takes your own words,
  so a form question, an eight-option question and a yes/no question can all be
  answered in prose. The words arrive at the agent as `text`, beside the values.
- Reply from the notification. On Android Chrome a question with a spare action
  slot carries a text action: type the answer in the shade and it lands without
  the app opening.
- Changing an answer. Tap a different option, or edit the words and send. The
  agent gets `changes`, a count of the replacements, and `changed_answers` on
  the next call it makes on the thread, so an agent that moved on is told.
- Back and forward in the live mode. The page is a strip of cards with a
  cursor: the arrows under the card, or the arrow keys, walk back through what
  you answered this sitting and forward to what is waiting. The position
  replaces the count of what is left.
- Answers colour themselves. A plain affirmative comes out mint and a plain
  denial rose - whole labels, matched against two published lists - and every
  other option takes a pastel from the palette by position, so two choices are
  told apart before they are read. Green and red are never handed out by
  position. `colors` on a `buttons` block, and `--color` on `agent-notify-pwa
  ask`, override the whole rule per option.
- Clear on Done. The section grows a Clear that archives the threads under it.
  `POST /api/v1/archive` is a soft delete on `events`: the rows leave every
  list, and nothing in the app can delete an archived event afterwards - not
  the agent's `clear`, not the retention cron. Taking a thread out of the app
  is not a request to lose it.
- Syntax highlighting in code blocks, from the `lang` an agent could always
  send and the renderer used to drop. The highlighter is a 24 kB gzip chunk of
  its own, fetched only when a block that needs it is on screen; the plain
  block paints first and stays standing if the chunk never arrives.
- Copy on a code block. A strip above the block copies the raw text the agent
  sent, never the highlighted DOM. Where the clipboard API is missing it is not
  rendered at all, rather than rendered and lying.
- Sortable tables. A tap on a header cell cycles ascending, descending, then
  back to the order the agent sent. The comparator reads the leading number out
  of a cell, so `18ms`, `4.2 kB` and `1,024` sort as numbers, and empty cells
  sink to the bottom whichever way the column points.
- Collapsible messages. Each message in a thread is a native `<details>`. A
  question still waiting, anything unread and the newest message are open on
  arrival; everything settled starts shut, with the answer you gave on the
  summary line, so you can tell without opening it whether it is worth opening.
- `idle_minutes` on every write path, 1 to 10080, and `--idle` on the CLI. It
  is how long a thread may stay quiet before it counts as finished, and the
  latest value on the thread wins.
- The task row is a timeline. Each row carries the last three events on its
  thread - kind, title, time, and for a question, what was decided - instead of
  the newest title and a count of the rest. `GET /api/v1/tasks` returns
  `recent` for it.

### Changed

- "Done" is the agent's word, not the human's. A thread is finished when its
  newest event is `kind: done`, or when it has been quiet longer than its idle
  timeout, four hours by default. It is no longer finished by the human having
  read everything in it, which dropped a thread the agent was still working on
  into Done the moment its last update was seen. An `error` does not finish a
  thread, because an agent that hit one may still retry.

  **This changes what existing agents produce.** One that never sends `kind:
  done` will see its threads sit in Active for four hours instead of falling
  into Done on read. End a run with a `done`, or raise `--idle` before going
  quiet.
- The retention cron archives instead of deleting. Nothing in the app deletes
  on its own any more: only the trash panel and the agent `clear` endpoint
  delete, and both skip archived rows.
- A bigger type scale and one web font. Atkinson Hyperlegible Next, self-hosted
  as a 33 kB variable file with a metric-matched fallback, so the swap changes
  the shapes and never moves a line. Body 15 to 17 px, page titles 17 to 22,
  buttons 36 to 44 px tall, radius 4 to 8.
- The thread reads newest first, so a question still waiting is at the top,
  where the reader lands and where the buttons want to be.
- Back sits on the left of the header, where the app name was. The name only
  earns its room on the one page with nowhere to go back to.
- Callouts are chips with an icon, a tinted surface and an edge, not a coloured
  rail. A rail alone left colour carrying the whole message.
- The bell stays on screen at zero, muted, instead of disappearing. A control
  that comes and goes is one whose position has to be found again each time.
- The answer buttons are outlines in their own colour, and the answers on a
  list row share one fixed column. Eleven solid pale blocks down a five-row
  list won the hierarchy against the titles they belong to.
- The body of `POST /api/v1/questions/:id/answer` is an envelope of `answer`
  and `text`, with an optional `if_pending` that writes only while the question
  is still waiting. The endpoint is session-only, so this changes nothing for
  an agent; a browser that has the app cached picks the new shape up with the
  new build.
- `GET /api/v1/questions/:id` returns `text` and `changes` beside the answer.
- More is replaced by Reply in the notification's action row.
- `agent-notify-pwa ask` prints `{ "choice": ..., "text": ... }`. `jq -r
  .choice` still reads the option and is null on an answer of words alone.

### Removed

- The count on the right of a task row, and the "Open to answer" link under a
  question in a list. The row's own lines already say what the events are, and
  the row was already a link to the same thread.

### Fixed

- Back from a question opened in Needs you returns to Needs you, not to the
  question's project. The thread page reads a `from` search param, so it
  survives a reload and a shared URL.
- The timeline rail on a task row runs under the dots, down their centre.

## [1.1.0] - 2026-09-03

### Changed

- The header shows a connection dot instead of the refresh bar. The bar tracked
  "a request is in flight", and since the lists poll every 5 seconds it blinked
  almost without pause. The dot answers the question the bar was standing in
  for: filled green while the hub answers, a hollow red ring when it does not,
  and it changes only when that changes.

## [1.0.0] - 2026-09-03

### Changed

- The Worker is named `agent-pwa-notifications`. Its `workers.dev` URL changes
  with it, so the old origin stops serving this app. A push subscription, a
  session and an installed PWA are all bound to an origin, so each device signs
  in and enables notifications once more. The D1 database keeps the name
  `agent-dash`, because D1 cannot rename one, and no data moves.

### Added

- `public_docs/development.md`: the layout, the two test projects and why they
  need different runtimes, how to add an endpoint or a block type, and how to
  pull a change from upstream by hand.
- `public_docs/release.md`: what `scripts/release.sh` does, what the tag
  triggers, the repository secret and variable the deploy needs, and how to
  roll back.
- A `publish-cli` job in the release workflow. It publishes `cli/` to npm with
  provenance, and checks the package version against the tag first. Without an
  `NPM_TOKEN` secret it reports the skip and succeeds, so a release still
  deploys and still cuts a GitHub Release.
- The CLI is packaged for Arch Linux as `agent-pwa-notifications`, built from
  the GitHub release tarball. It installs under
  `/usr/lib/agent-pwa-notifications` with `agent-notify-pwa` on the PATH, so it
  does not depend on npm.

### Changed

- The README is rewritten around this app: what it is, deploying your own,
  connecting an agent over MCP, the skill, the CLI or plain HTTP, how
  notification answers work, and what the fork changes. The attribution to
  Prajeevan/agent-dash and the MIT licence stay.
- `public_docs/notifications.md` carries the measured desktop row:
  Firefox 154 on Linux reports `Notification.maxActions` 2, so a two-option
  question shows both answers and no More, and a three-option question shows
  one answer plus More.
- The CLI install instructions name the checkout and the AUR package. The
  package is not on npm, so nothing tells you to install it from there.
- The local setup secrets file is `.agent-notify-pwa.local.json`. A checkout
  that still holds the old `.agent-dash.local.json` is read as before, and both
  names stay out of git.
- The root package is named `agent-pwa-notifications`, like the repository and
  the CLI package.

### Removed

- Upstream's `PLAN.md` architecture report. It describes a hosted service with
  endpoints, an MCP tool and a skill path that this server does not have, so it
  now misleads more than it explains. It is unchanged upstream at
  Prajeevan/agent-dash, and in this repository's history.

## [0.5.0] - 2026-09-03

### Added

- Design tokens in `src/styles.css`, declared once inside Tailwind's `@theme`
  so each one is both a utility and a CSS variable. Colour now carries meaning
  and nothing else: the kind of an event, the project it belongs to and the
  state of a question. Question state reads off the kind colours, so no state
  invents a colour of its own.
- A component set in `src/lib/ui/`: `Row`, `KindLabel`, `ProjectDot`,
  `UnreadDot`, `Button` (primary, secondary, danger), `Section`, `Skeleton`,
  `InlineError`, `Snippet`.
- Inline answers on the project page. A pending micro-question (one buttons
  block, 2 or 3 short options, not encrypted) shows its options under the row
  and answers without opening the thread. Anything larger shows "Open to
  answer". `GET /api/v1/tasks` carries the options as `pending_answers`, built
  with the same rule as the notification quick answers.
- `src/lib/brand.ts` holds the app name in one place.

### Changed

- Compact, flat layout. Lists are rows with a hairline between them, not
  cards: 8px by 12px of padding, one line of content, one muted detail line.
  A project row is 53px tall and the projects page fits ten of them on a
  390 by 844 screen without scrolling.
- Settings is one column of headings, no cards, ending in an About section
  with the version and the upstream attribution.
- The thread marks each message with a 3px rail in its kind colour instead of
  a bordered card. An answered question reads "You answered: X", then whether
  the agent has picked it up.
- The app is named "Agent Notifications", short name "Agents". New bell icon
  and regenerated `icon-192.png`, `icon-512.png`, `icon-maskable.png` and a
  monochrome `badge.png`.

### Removed

- The aurora background, every gradient, every box shadow and the backdrop
  blur on the header.
- Inline style objects, except for the three genuinely dynamic values: a
  project colour, a progress width and a skeleton size.
- Every emoji, arrow and other non-ASCII character in `src/` and in the
  manifest.

### Fixed

- Pinch-zoom is no longer disabled by `maximum-scale=1` (WCAG 1.4.4).
- Links inside a block of text are underlined, so they are not distinguished
  by colour alone (WCAG 1.4.1).
- Horizontally scrollable code blocks and tables are keyboard reachable.
- Every text token meets 4.5:1 on both surfaces. Input borders and focus rings
  use their own token at 3.9:1 rather than the hairline divider colour.

## [0.4.0] - 2026-09-02

### Added

- A front-end data layer built on TanStack Query. One `QueryClient`
  (`src/lib/query.ts`), one place for keys, fetchers and mutations
  (`src/lib/queries.ts`), and a route loader per page that reads from the cache
  first. A navigation that has data shows it at once and refreshes behind the
  content.
- The query cache is persisted in `localStorage` under one key, so after a cold
  start the app paints the last known lists before the network answers.
- A pathless `_app` layout route. The header is mounted once and never
  unmounts between pages; a page contributes its header actions through a
  context. `/login` stays outside it.
- Page skeletons in the content area (`src/lib/skeleton.tsx`) and a 2px refresh
  line on the bottom edge of the header while any query is in flight.
- An inline error line with a retry button, for a page whose query failed with
  nothing cached to fall back on.

### Changed

- Polling and the instant-mode WebSocket moved into one `useLiveRefresh` hook,
  mounted once by the layout. Pages no longer fetch on their own, and
  `/api/v1/config` is fetched once instead of once per page mount.
- The session check is a route guard on the layout: a logged-out visitor lands
  on `/login` with `next` set, from any app route, and comes back to `next`
  after signing in. A 401 that arrives later, on a query, redirects the same
  way.
- Answering a question settles it in the cache before the round trip, so the
  buttons go away on tap. A failed answer rolls back and shows the reason.
- A push deep link (`/event/<id>`) resolves and redirects before anything
  renders, so it lands in the thread inside the app layout.

### Removed

- The Pro page, the Pro badge, the marketing landing page and the full-page
  spinner and lock screens they came with.

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
