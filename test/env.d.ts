import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import type { Env as AppEnv } from '../src/server/env'

// The bindings `vitest.config.ts` hands the workers pool, on top of the ones
// wrangler.jsonc declares. Declaration merging makes `env` from
// `cloudflare:workers` carry the app's own Env shape inside tests.
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
