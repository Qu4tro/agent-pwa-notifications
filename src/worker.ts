// The Worker entry: a thin shell. Routing lives in `src/server/router.ts` so
// that tests can exercise the API without the Vite-generated Start entry.

import startEntry from '@tanstack/react-start/server-entry'
import type { Env } from './server/env'
import { handleApi } from './server/router'
import { runCron } from './server/cron'

export { Hub } from './server/hub'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const handled = await handleApi(request, env, ctx)
    if (handled) return handled

    // Everything else -> TanStack Start SSR (the dashboard/PWA).
    // @ts-expect-error - the default server entry exposes a Cloudflare-style fetch
    return startEntry.fetch(request, env, ctx)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env))
  },
}
