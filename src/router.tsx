import { Link, createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { createQueryClient, persistCache, setUnauthorizedHandler } from './lib/query'
import { setLiveDefaults } from './lib/live'

function NotFound() {
  return (
    <main
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <p style={{ fontSize: '4rem', fontWeight: 700, color: '#7c5cff', margin: 0 }}>404</p>
      <h1 style={{ margin: 0 }}>Not found</h1>
      <Link to="/" style={{ color: '#7c5cff', fontWeight: 600 }}>
        Back to inbox
      </Link>
    </main>
  )
}

export function getRouter() {
  const queryClient = createQueryClient()
  setLiveDefaults(queryClient)
  // Runs before the router mounts, so the first paint after a cold start comes
  // from the last known lists rather than from the network.
  persistCache(queryClient)

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // No delay before a pending component and no minimum on how long it stays:
    // a loader that resolves from the cache must not flash a skeleton.
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultNotFoundComponent: NotFound,
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })

  // A persisted cache can hold an account whose session has since expired, so
  // the 401 can arrive long after the route guard ran. Same landing as the
  // guard: the login page, with the way back.
  if (typeof window !== 'undefined') {
    setUnauthorizedHandler(() => {
      if (window.location.pathname === '/login') return
      const next = window.location.pathname + window.location.search
      router.navigate({ to: '/login', search: { next }, replace: true })
    })
  }

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
