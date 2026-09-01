import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { beforeAll } from 'vitest'

// The workers pool gives every test file a blank D1 instance. Apply the real
// migrations from `migrations/` so the tests run against the shipped schema.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
