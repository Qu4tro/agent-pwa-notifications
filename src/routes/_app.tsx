import { useEffect } from 'react'
import { Navigate, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AuthError } from '../lib/api'
import { accountQuery } from '../lib/queries'
import { appHasMounted, markAppMounted } from '../lib/hydration'
import { Header } from '../lib/shell'
import { captureKeyFromHash } from '../lib/e2e'
import { useLiveRefresh } from '../lib/live'

// Everything behind the session lives under this pathless layout: the header
// is mounted once, the guard runs once per navigation, and the live refresh
// has a single home. `/login` stays outside it.
export const Route = createFileRoute('/_app')({
  ssr: false,
  beforeLoad: async ({ context, location }): Promise<{ signedIn: boolean; next?: string }> => {
    try {
      // Cached after the first call (staleTime Infinity), so a navigation
      // does not spend a request on the guard.
      await context.queryClient.query(accountQuery())
      return { signedIn: true }
    } catch (error) {
      if (!(error instanceof AuthError)) throw error
      const next = location.href
      // A thrown redirect becomes a navigation the moment the router catches
      // it. On the first load of the document that lands in the middle of
      // hydration, so the answer goes to the component instead: it renders
      // nothing and navigates from an effect, once React is done.
      if (!appHasMounted()) return { signedIn: false, next }
      throw redirect({ to: '/login', search: { next } })
    }
  },
  component: AppRoute,
})

function AppRoute() {
  const { signedIn, next } = Route.useRouteContext()
  if (!signedIn) return <Navigate to="/login" search={{ next }} replace />
  return <AppLayout />
}

function AppLayout() {
  useLiveRefresh()

  useEffect(() => {
    markAppMounted() // hydration is over; a redirect may navigate from here on
    captureKeyFromHash() // a login QR can carry the E2E key in the URL fragment
  }, [])

  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}
