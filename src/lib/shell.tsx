import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Focus, Settings2 } from 'lucide-react'
import { APP_NAME } from './brand'
import { pendingQuery } from './queries'
import { badgeClass, iconButtonClass } from './ui'

// Mounted once by the app layout, so it never unmounts between pages, and the
// same on every page: nothing in it comes or goes with the page under it.
//
// The name is on every page and it is always the way to the project list. It
// used to stand aside on a sub page for a back link pointing at whatever that
// page's parent was, which meant the one fixed landmark in the app was missing
// from every page but one, and the way home changed name as you moved. One
// title, one destination, always in the same place.
//
// The right side is the same three, in the same order, wherever you are: the
// bell is the way to what is waiting, the live mode the way to answer it one
// question at a time, and settings at the edge. Pages used to add their own
// control after these - settings on the project list, a clear on a project -
// so what stood at the right changed from page to page and the eye had to
// find it again; a page's own control now stands on the page.
export function Header() {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-line bg-bg">
      <div className="mx-auto flex h-13 max-w-[44rem] items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="truncate font-semibold text-text no-underline">
            {APP_NAME}
          </Link>
          <ConnectionDot />
        </div>
        <div className="flex items-center gap-1">
          <PendingButton />
          <LiveButton />
          <SettingsButton />
        </div>
      </div>
    </header>
  )
}

// Everything waiting on you, from wherever you are. The count is the one thing
// worth carrying on every page, and the app already knows it: the pending query
// polls with the lists, so the badge is as live as the rows behind it.
//
// The bell stays even at zero, muted, so the eye knows where to look when
// something arrives. The count badge appears only when there is something.
function PendingButton() {
  const { data } = useQuery(pendingQuery())
  const waiting = data?.length ?? 0
  return (
    <Link
      to="/pending"
      title="Needs you"
      aria-label={
        waiting === 0
          ? 'Needs you'
          : `Needs you: ${waiting} question${waiting === 1 ? '' : 's'}`
      }
      className={`${iconButtonClass} relative ${
        waiting > 0
          ? 'text-kind-question hover:text-kind-question'
          : 'text-muted hover:text-text'
      }`}
    >
      <Bell size={18} aria-hidden />
      {waiting > 0 ? (
        <span
          aria-hidden
          className={`${badgeClass} absolute top-1 right-0.5 bg-kind-question text-bg`}
        >
          {waiting}
        </span>
      ) : null}
    </Link>
  )
}

// The same queue as the bell's, one question at a time. It stood on the
// pending page alone, which made it a view of that page; it is a place of its
// own - a screen to leave open on a desk - so it is reached from every page.
function LiveButton() {
  return (
    <Link to="/pending/live" title="Live mode" aria-label="Live mode" className={iconButtonClass}>
      <Focus size={18} aria-hidden />
    </Link>
  )
}

function SettingsButton() {
  return (
    <Link to="/settings" title="Settings" aria-label="Settings" className={iconButtonClass}>
      <Settings2 size={18} aria-hidden />
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

export function Container({ children }: { children: React.ReactNode }) {
  return <main className="safe-bottom mx-auto max-w-[44rem] pt-5">{children}</main>
}
