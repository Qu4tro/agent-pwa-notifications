import { createContext, useContext, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell } from 'lucide-react'
import { APP_NAME } from './brand'
import { pendingQuery } from './queries'
import { iconButtonClass } from './ui'

// Mounted once by the app layout, so it never unmounts between pages. Pages
// contribute their own slots through `useHeaderBack` and `useHeaderActions`.
//
// The left slot is where a page says how to get out of it, and on a sub page
// the back link stands in for the app name: the name is only worth the room on
// the one page that has nowhere to go back to. Back on the left is where every
// phone puts it, and where a thumb looks for it. Actions stay on the right.
export function Header({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-line bg-bg">
      <div className="mx-auto flex h-13 max-w-[44rem] items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          {left ?? (
            <Link to="/" className="truncate font-semibold text-text no-underline">
              {APP_NAME}
            </Link>
          )}
          <ConnectionDot />
        </div>
        <div className="flex items-center gap-1">
          <PendingButton />
          {right}
        </div>
      </div>
    </header>
  )
}

// Everything waiting on you, from wherever you are. The count is the one thing
// worth carrying on every page, and the app already knows it: the pending query
// polls with the lists, so the badge is as live as the rows behind it.
//
// Nothing at all when nothing is waiting. A bell that is always there, always
// at zero, is a bell nobody looks at.
function PendingButton() {
  const { data } = useQuery(pendingQuery())
  const waiting = data?.length ?? 0
  if (waiting === 0) return null
  return (
    <Link
      to="/pending"
      title="Needs you"
      aria-label={`Needs you: ${waiting} question${waiting === 1 ? '' : 's'}`}
      className={`${iconButtonClass} relative text-kind-question hover:text-kind-question`}
    >
      <Bell size={18} aria-hidden />
      <span
        aria-hidden
        className="absolute top-1 right-0.5 min-w-[1.1rem] rounded-full bg-kind-question px-1 text-center text-[12px] leading-[1.1rem] font-semibold text-bg"
      >
        {waiting}
      </span>
    </Link>
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

// The header outlives the pages, so a page hands it its slots instead of
// rendering its own header. The layout owns the state; a page fills a slot and
// gets out of the way when it unmounts. Two setters rather than one node, so
// filling one slot never clears the other.
export interface HeaderSlots {
  setLeft: (node: React.ReactNode) => void
  setRight: (node: React.ReactNode) => void
}

export const HeaderActionsContext = createContext<HeaderSlots>({
  setLeft: () => {},
  setRight: () => {},
})

// The right slot: what this page can do. Trash, settings, and the like.
export function useHeaderActions(node: React.ReactNode, deps: React.DependencyList) {
  const { setRight } = useContext(HeaderActionsContext)
  useEffect(() => {
    setRight(node)
    return () => setRight(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// The left slot: the way out of this page, in place of the app name.
export function useHeaderBack(node: React.ReactNode, deps: React.DependencyList) {
  const { setLeft } = useContext(HeaderActionsContext)
  useEffect(() => {
    setLeft(node)
    return () => setLeft(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function Container({ children }: { children: React.ReactNode }) {
  return <main className="safe-bottom mx-auto max-w-[44rem] pt-5">{children}</main>
}

// A back link in the header. Always the same shape, so the way out of a page
// is always in the same place.
export function BackLink({ to, params, label }: { to: string; params?: object; label: string }) {
  return (
    <Link
      // The router's typed link map cannot see a `to` passed as a prop.
      to={to as never}
      params={params as never}
      // -ml-1 pulls the arrow back onto the header's own 16px gutter, so the
      // way out starts at the same edge as everything under it.
      className="-ml-1 inline-flex min-h-11 min-w-0 items-center gap-1.5 px-1 text-[16px] text-muted no-underline hover:text-text"
    >
      <ArrowLeft size={18} aria-hidden />
      <span className="max-w-[10rem] truncate">{label}</span>
    </Link>
  )
}
