import { createContext, useContext, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useIsFetching } from '@tanstack/react-query'

// Mounted once by the app layout, so it never unmounts between pages. Pages
// contribute their own actions through `useHeaderActions`.
export function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header
      className="safe-top"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem',
      }}
    >
      <div style={{ maxWidth: '46rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', textDecoration: 'none', color: 'var(--text)' }}>
            <Logo />
            <span style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>Agent Dash</span>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{right}</div>
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
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '-1px',
        height: '2px',
        overflow: 'hidden',
        opacity: fetching > 0 ? 1 : 0,
        transition: 'opacity 150ms linear',
      }}
    >
      <div className="refresh-bar" style={{ height: '2px', background: 'var(--accent)' }} />
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

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#7c5cff" />
      <path d="M16 7a6 6 0 0 0-6 6v3.6l-1.4 2.2a1 1 0 0 0 .85 1.53h13.1a1 1 0 0 0 .85-1.53L22 16.6V13a6 6 0 0 0-6-6Z" fill="#fff" />
      <path d="M13.6 22.5a2.5 2.5 0 0 0 4.8 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Container({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-bottom" style={{ maxWidth: '46rem', margin: '0 auto', padding: '1rem' }}>
      {children}
    </main>
  )
}

// What a page shows when its query failed and there is nothing cached to show
// instead. One line, one button, inside the content area.
export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        flexWrap: 'wrap',
        padding: '0.7rem 0.9rem',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--error)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg-elev)',
        fontSize: '0.9rem',
      }}
    >
      <span style={{ color: 'var(--muted)' }}>{message}</span>
      <button
        onClick={onRetry}
        style={{
          marginLeft: 'auto',
          padding: '0.35rem 0.8rem',
          borderRadius: '0.5rem',
          border: '1px solid var(--border)',
          background: 'var(--bg-elev2)',
          color: 'var(--text)',
          fontWeight: 600,
          fontSize: '0.85rem',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}
