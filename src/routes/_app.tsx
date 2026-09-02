import { useEffect, useState } from 'react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { AuthError } from '../lib/api'
import { accountQuery } from '../lib/queries'
import { Header, HeaderActionsContext } from '../lib/shell'
import { captureKeyFromHash } from '../lib/e2e'
import { useLiveRefresh } from '../lib/live'

// Everything behind the session lives under this pathless layout: the header
// is mounted once, the guard runs once per navigation, and the live refresh
// has a single home. `/login` stays outside it.
export const Route = createFileRoute('/_app')({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    try {
      // Cached after the first call (staleTime Infinity), so a navigation
      // does not spend a request on the guard.
      await context.queryClient.query(accountQuery())
    } catch (error) {
      if (error instanceof AuthError) {
        throw redirect({ to: '/login', search: { next: location.href } })
      }
      throw error
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const [actions, setActions] = useState<React.ReactNode>(null)
  useLiveRefresh()

  useEffect(() => {
    captureKeyFromHash() // a login QR can carry the E2E key in the URL fragment
  }, [])

  return (
    <HeaderActionsContext.Provider value={setActions}>
      <Header right={actions} />
      <Outlet />
    </HeaderActionsContext.Provider>
  )
}
