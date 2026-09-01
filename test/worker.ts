// The Worker entry the vitest workers pool runs. It mirrors src/worker.ts but
// stops at handleApi instead of falling through to the TanStack Start SSR
// entry, which only exists after a Vite build.

import type { Env } from '../src/server/env'
import { handleApi } from '../src/server/router'

export { Hub } from '../src/server/hub'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const handled = await handleApi(request, env, ctx)
    return handled ?? new Response('Not found.', { status: 404 })
  },
}
