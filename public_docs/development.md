# Development

The hub is one Cloudflare Worker. It serves a TanStack Start app for the human
and a REST plus MCP surface for agents, on the same origin.

You need Node 22.12 or newer and pnpm 11.

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars    # local secrets, gitignored
pnpm dev                          # http://localhost:3000
```

`pnpm dev` runs the Worker through the Vite plugin against a local D1 and a
local KV, both under `.wrangler/`. Nothing touches a deployed hub.

## Layout

```
src/worker.ts          the entry: handleApi first, then the SSR handler
src/server/router.ts   every non-SSR route; returns null when SSR owns the URL
src/server/api.ts      the agent and dashboard handlers, and the D1 queries
src/server/auth.ts     sessions in KV, one-time codes, login links, key hashing
src/server/blocks.ts   the zod schema for the block types agents may send
src/server/quick-answers.ts  when a question may answer from a notification
src/server/push.ts     VAPID signing and RFC 8291 payload encryption
src/server/mcp.ts      the five MCP tools, wrapped around the same handlers
src/server/cron.ts     the hourly job: expire questions, prune old events
src/server/hub.ts      the opt-in Durable Object behind INSTANT=1
src/lib/queries.ts     every query key and fetcher the app uses
src/lib/blocks.tsx     the renderer for each block type
src/lib/ui/            the shared components: Row, Button, Section, KindLabel
src/routes/            the app routes; _app.* sit inside the signed-in layout
public/sw.js           the service worker: push, notification actions, answers
migrations/            D1 schema, applied in order by name
test/                  unit tests on node, API tests on workerd
```

The version comes from `package.json` and reaches the Worker as
`__APP_VERSION__`, injected by `vite.config.ts` for builds and by a small
plugin in `vitest.config.ts` for tests. `GET /api/v1/config` reports it.

## Tests

```bash
pnpm test                 # both projects
pnpm test:watch
pnpm exec vitest run --project unit
pnpm exec vitest run --project api
```

Two projects, because they need different runtimes:

- `test/unit/**` runs on node. Pure functions only: the quick-answer rule, the
  service-worker action rule, the query keys.
- `test/api/**` runs on real workerd through `@cloudflare/vitest-pool-workers`,
  with an isolated D1 and KV per test file. `test/setup.ts` applies the
  migrations in `migrations/` to that D1, so a schema change is picked up by
  the tests without any fixture to update.

The API tests import `test/worker.ts`, not `src/worker.ts`. The real entry
imports the Start server entry, which only exists after a Vite build; the test
entry exposes `handleApi` and the `Hub` Durable Object class that
`wrangler.jsonc` binds, and nothing else.

Push is verified by asserting the request that `push.ts` would sign, not by
delivering to a browser. Real delivery is checked by hand; see
[notifications.md](notifications.md).

## Adding an endpoint

1. Write the handler in `src/server/api.ts`. It takes a `Request` and the
   account, and returns a `Response`.
2. Route it in `src/server/router.ts`, inside the agent block (bearer key) or
   the dashboard block (session cookie).
3. Document it in `src/server/docs.ts`, which builds
   `GET /api/v1/openapi.json`. An endpoint an agent may call belongs there.
4. Add a test under `test/api/`.
5. If an agent should reach it through MCP, add a tool in `src/server/mcp.ts`;
   the tools wrap the same handlers through a synthesized request.
6. If the skill should teach it, update `skills/agent-notifications/SKILL.md`.

## Adding a block type

1. Add the zod variant in `src/server/blocks.ts`. The schema is the contract:
   `GET /api/v1/schema.json` is generated from it.
2. Render it in `src/lib/blocks.tsx`. Never render agent text as HTML.
3. If it is interactive, decide what it means for a question: the quick-answer
   rule in `src/server/quick-answers.ts` accepts exactly one `buttons` block,
   and anything else makes a question tap-to-open.
4. Cover the rule change in `test/unit/quick-answers.test.ts`.

## Styling

Tailwind 4 utilities plus the design tokens declared once in `src/styles.css`
inside `@theme`, so each token is both a utility and a CSS variable. Colour
carries meaning: the kind of an event, the project it belongs to, the state of
a question. There are no inline style objects; do not reintroduce them, except
where the value is data rather than a styling decision - a project's colour, an
agent's answer colour, a theme's swatch.

Text is plain ASCII everywhere, including UI strings.

### Themes

A theme is a second set of values for those same tokens, under a `data-theme`
attribute on `<html>`, in `src/themes/<id>.css`. Every utility compiles to
`var(--color-...)`, so re-declaring the tokens re-paints the whole app and no
component knows a theme exists. Three rules:

1. A theme re-declares **every** token `@theme` declares. One left out falls
   back to the default's value, which on a light theme is a colour drawn to be
   read on near-black. `test/unit/theme.test.ts` fails when one is missing, and
   checks the new palette's contrast while it is there.
2. What a variable cannot say - a bevel is a shape, not a colour - goes on the
   `ui-` marker classes the shared components carry (`ui-btn`, `ui-field`,
   `ui-window`, `ui-dialog`, and the rest). They carry no rules of their own;
   nothing but a theme may style them, and no theme may select on a layout
   class. Theme rules are unlayered, which is how they beat a utility and its
   `hover:` variant without `!important`.
3. `src/lib/theme.ts` is the list, the storage key and the inline boot script,
   and adding a theme there and a file under `src/themes/` is the whole of it.
   The choice lives in this browser's localStorage, never on the hub.

## Conventions

- Conventional Commits.
- `pnpm typecheck && pnpm test && pnpm build` before a push. CI runs the same
  three on every pull request.
- One pull request per change, and the release notes go in `CHANGELOG.md`
  under `Unreleased`.
