import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// vite.config.ts injects __APP_VERSION__ through `define`, but the workers pool
// builds its module graph from the wrangler config, which never sees Vite's
// `define`. Substitute the token here so the tests run against the same version
// string the deployed Worker reports.
const appVersion = {
  name: 'app-version-define',
  transform(code: string) {
    if (!code.includes('__APP_VERSION__')) return null
    return { code: code.replaceAll('__APP_VERSION__', JSON.stringify(version)), map: null }
  },
}

// Test-only VAPID pair. The real keys are Worker secrets and never live here.
const vapid = JSON.parse(readFileSync(new URL('./test/fixtures/vapid.json', import.meta.url), 'utf8'))

// The schema the API tests run against. `test/setup.ts` applies these to the
// isolated D1 instance the pool hands each test file.
const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  test: {
    projects: [
      // Pure functions: no Workers runtime needed, so run them on node.
      {
        plugins: [appVersion],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      // API integration: real workerd, real D1 and KV, through miniflare.
      {
        plugins: [
          appVersion,
          cloudflareTest({
            // Not src/worker.ts: that imports the Vite-generated Start server
            // entry. test/worker.ts exposes the same API surface plus the Hub
            // Durable Object class that wrangler.jsonc binds.
            main: './test/worker.ts',
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                APP_SECRET: 'test-app-secret',
                VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY,
                VAPID_PRIVATE_KEY: vapid.VAPID_PRIVATE_KEY,
                VAPID_SUBJECT: vapid.VAPID_SUBJECT,
                TEST_MIGRATIONS: migrations,
              },
            },
          }),
        ],
        test: {
          name: 'api',
          include: ['test/api/**/*.test.ts'],
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
})
