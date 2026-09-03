import { createContext, useContext, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useIsFetching } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { APP_NAME } from './brand'

// Mounted once by the app layout, so it never unmounts between pages. Pages
// contribute their own actions through `useHeaderActions`.
export function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-line bg-bg">
      <div className="mx-auto flex h-11 max-w-[44rem] items-center justify-between gap-3 px-3">
        <Link to="/" className="truncate font-semibold text-text no-underline">
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-1">{right}</div>
      </div>
      <RefreshBar />
    </header>
  )
}

// The only "something is loading" signal in the app: a 2px line on the bottom
// edge of the header while any query is in flight. Content never disappears
// behind a spinner.
function RefreshBar() {
  const fetching = useIsFetching()
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute right-0 -bottom-px left-0 h-0.5 overflow-hidden transition-opacity duration-150 ${
        fetching > 0 ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="refresh-bar h-0.5 bg-kind-question" />
    </div>
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
