// The one QueryClient for the app, plus the localStorage cache that survives a
// PWA cold start. Everything the pages read goes through here, so a navigation
// paints from the cache first and refreshes behind the content.

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { AuthError } from './api'

// One key holds the whole dehydrated cache. Bumping the app version busts it,
// so a release never reads a shape it no longer understands.
const CACHE_KEY = 'agent-notifications-cache'
const GC_TIME = 24 * 60 * 60 * 1000
const STALE_TIME = 2000

// The session can expire while a persisted cache still holds an account, so a
// 401 can surface long after the route guard ran. The router registers the
// redirect here; lib code must not import the router.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}
function handleError(error: unknown) {
  if (error instanceof AuthError) onUnauthorized?.()
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        // One retry for a flaky network, none for a 401: that one is settled.
        retry: (failureCount, error) => !(error instanceof AuthError) && failureCount < 1,
        refetchOnWindowFocus: true,
      },
    },
  })
}

// Logging out must not leave the next visitor with the last account's lists.
export function clearPersistedCache() {
  try {
    window.localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

// Restores the last known lists before the router mounts, so the first paint
// after a cold start shows content instead of skeletons. Older persisted data
// never overwrites fresher data already in the cache.
export function persistCache(client: QueryClient) {
  if (typeof window === 'undefined') return
  let storage: Storage
  try {
    storage = window.localStorage
  } catch {
    return // private mode, or storage disabled
  }
  persistQueryClient({
    queryClient: client,
    persister: createSyncStoragePersister({ storage, key: CACHE_KEY, throttleTime: 1000 }),
    maxAge: GC_TIME,
    buster: __APP_VERSION__,
  })
}
