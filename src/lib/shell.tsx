import { createContext, useContext, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { APP_NAME } from './brand'

// Mounted once by the app layout, so it never unmounts between pages. Pages
// contribute their own actions through `useHeaderActions`.
export function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-line bg-bg">
      <div className="mx-auto flex h-11 max-w-[44rem] items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="truncate font-semibold text-text no-underline">
            {APP_NAME}
          </Link>
          <ConnectionDot />
        </div>
        <div className="flex items-center gap-1">{right}</div>
      </div>
    </header>
  )
}

// True until a fetch fails, false again as soon as one succeeds. The lists poll
// every 5 seconds, so a hub that comes back turns this green within one
// interval. Losing the network is its own signal: the runtime pauses fetches
// rather than failing them, so no error would ever arrive to notice.
function useHubReachable(): boolean {
  const client = useQueryClient()
  const [lastFetchOk, setLastFetchOk] = useState(true)
  const [online, setOnline] = useState(() => onlineManager.isOnline())

  useEffect(() => {
    const unsubscribeCache = client.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      if (event.action.type === 'success') setLastFetchOk(true)
      else if (event.action.type === 'error') setLastFetchOk(false)
    })
    const unsubscribeOnline = onlineManager.subscribe(setOnline)
    return () => {
      unsubscribeCache()
      unsubscribeOnline()
    }
  }, [client])

  return online && lastFetchOk
}

// The only "something is loading" signal used to be a bar on the header's
// bottom edge, tied to "a request is in flight". Against a 5 second poll it
// blinked almost continuously and taught the eye to skip it. This says the one
// thing worth knowing instead - whether the hub is answering - and it changes
// only when that changes. Filled green when it is, a hollow red ring when it
// is not: shape as well as colour, so the state does not rest on telling red
// from green (WCAG 1.4.1).
function ConnectionDot() {
  const reachable = useHubReachable()
  const label = reachable ? 'Connected' : 'Not connected'
  return (
    <span role="status" className="flex shrink-0 items-center">
      <span
        aria-hidden
        title={label}
        className={`inline-block size-2 shrink-0 rounded-full ${
          reachable ? 'bg-kind-done' : 'border-2 border-kind-error'
        }`}
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}

// The header outlives the pages, so a page hands it its actions instead of
// rendering its own header. The layout owns the state; a page calls
// `useHeaderActions` and gets out of the way when it unmounts.
export const HeaderActionsContext = createContext<(node: React.ReactNode) => void>(() => {})

export function useHeaderActions(node: React.ReactNode, deps: React.DependencyList) {
  const setActions = useContext(HeaderActionsContext)
  useEffect(() => {
    setActions(node)
    return () => setActions(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function Container({ children }: { children: React.ReactNode }) {
  return <main className="safe-bottom mx-auto max-w-[44rem] pt-3">{children}</main>
}

// A back link in the header. Always the same shape, so the way out of a page
// is always in the same place.
export function BackLink({ to, params, label }: { to: string; params?: object; label: string }) {
  return (
    <Link
      // The router's typed link map cannot see a `to` passed as a prop.
      to={to as never}
      params={params as never}
      className="inline-flex min-h-9 items-center gap-1 px-1 text-[14px] text-muted no-underline hover:text-text"
    >
      <ArrowLeft size={16} aria-hidden />
      <span className="max-w-[9rem] truncate">{label}</span>
    </Link>
  )
}
