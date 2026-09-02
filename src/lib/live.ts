import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { configQuery, LIVE_KEYS } from './queries'

const POLL_MS = 5000
const PING_MS = 30_000
const RECONNECT_MS = 4000

// The poll interval lives on the query defaults, not on a component, so it is
// in place before the first observer subscribes. `refetchIntervalInBackground`
// stays off, so a hidden tab or a backgrounded PWA costs nothing.
export function setLiveDefaults(client: QueryClient) {
  for (const queryKey of LIVE_KEYS) client.setQueryDefaults(queryKey, { refetchInterval: POLL_MS })
}

// Mounted once, in the app layout. It keeps the lists current: a poll while the
// tab is visible, a full refresh when the tab comes back, and - in instant mode
// (INSTANT=1) - a WebSocket to the Hub that refreshes the moment anything
// changes. Pages never fetch on their own.
export function useLiveRefresh() {
  const client = useQueryClient()
  const { data: config } = useQuery(configQuery())
  const instant = config?.instant === true

  useEffect(() => {
    setLiveDefaults(client)
  }, [client])

  // Coming back to the app is the moment the lists are most likely stale, and
  // a poll that fired while hidden was skipped. `config` never changes for the
  // life of a deploy, so it is left alone.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'config' })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [client])

  useEffect(() => {
    if (!instant) return
    let stopped = false
    let ws: WebSocket | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    let reconnect: ReturnType<typeof setTimeout> | null = null

    const open = () => {
      if (stopped) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws`)
      } catch {
        return // the 5s poll is still running underneath
      }
      ws.onmessage = (e) => {
        if (typeof e.data === 'string' && e.data !== 'pong' && document.visibilityState === 'visible') {
          client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'config' })
        }
      }
      ws.onclose = () => {
        if (!stopped) reconnect = setTimeout(open, RECONNECT_MS)
      }
      ws.onerror = () => {
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
      }
      // Keep-alive so a proxy does not drop an idle hibernated socket.
      if (ping) clearInterval(ping)
      ping = setInterval(() => {
        try {
          if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
        } catch {
          /* ignore */
        }
      }, PING_MS)
    }

    open()
    return () => {
      stopped = true
      if (ping) clearInterval(ping)
      if (reconnect) clearTimeout(reconnect)
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
    }
  }, [client, instant])
}
