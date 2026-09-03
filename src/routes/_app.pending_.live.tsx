import { useEffect, useReducer, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Lock } from 'lucide-react'
import { api, type EventItem, type TaskSummary } from '../lib/api'
import { BackLink, useHeaderBack } from '../lib/shell'
import { ensure, eventQuery, pendingQuery, LIVE_KEYS } from '../lib/queries'
import { LiveSkeleton } from '../lib/skeleton'
import { BlockRenderer, Callout } from '../lib/blocks'
import { AnswerArea, LockedNote, prepareAnswer, shortAnswer, useQuestionContent } from '../lib/question'
import { projectLabel, STATE_TEXT } from '../lib/project'
import { InlineError, ProjectDot, Time } from '../lib/ui'

// One question on the screen at a time, and nothing else. Not the list with a
// different skin: a list asks you to choose what to answer first, and choosing
// is the part that makes a queue feel like a queue.
//
// A route rather than a toggle on /pending, because a calm screen is something
// to leave open on a desk or to set as the installed app's start page, and
// that is a URL. The trailing underscore on `pending_` keeps this out of the
// pending page's tree, which has no <Outlet/>.
//
// It learns about a new question through the channel the app already has:
// `pendingQuery` is polled every 5 seconds while the tab is visible and, in
// instant mode, invalidated the moment the server writes. This page never
// fetches on its own.

export const Route = createFileRoute('/_app/pending_/live')({
  ssr: false,
  loader: ({ context }) =>
    context.signedIn ? ensure<TaskSummary[]>(context.queryClient, pendingQuery()) : undefined,
  pendingComponent: LiveSkeleton,
  component: LivePage,
})

// -- The queue ----------------------------------------------------------------

export type LivePhase = 'empty' | 'entering' | 'showing' | 'acked' | 'leaving'

export interface LiveState {
  // The question on screen, or null when nothing is.
  current: string | null
  phase: LivePhase
  // Everything behind it, oldest first.
  queue: string[]
  // The answer just given, held for as long as the acknowledgement is up.
  answered: string | null
}

export type LiveInput =
  | { type: 'data'; ids: string[] }
  | { type: 'answered'; answer: string }
  | { type: 'failed' }
  | { type: 'stale' }
  | { type: 'timer' }

export const LIVE_START: LiveState = { current: null, phase: 'empty', queue: [], answered: null }

// The whole of the mode's behaviour, as one pure function. Nothing here knows
// about React, a clock or the network: the page turns a poll, a tap and an
// expired timer into these four inputs and paints whatever comes back.
export function liveQueue(state: LiveState, input: LiveInput): LiveState {
  switch (input.type) {
    case 'data': {
      // FIFO with no sort of its own: getPending already returns oldest first,
      // and anything that has left the data has been answered or has expired.
      const queue = input.ids.filter((id) => id !== state.current)
      const gone = state.current != null && !input.ids.includes(state.current)
      // A card settled somewhere else - the phone, another tab, a timeout -
      // has nothing to acknowledge, so it leaves without one.
      if (gone && (state.phase === 'entering' || state.phase === 'showing'))
        return { ...state, phase: 'leaving', answered: null, queue }
      if (queue.length === state.queue.length && queue.every((id, i) => id === state.queue[i]))
        return state
      return { ...state, queue }
    }
    case 'answered':
      if (state.phase !== 'entering' && state.phase !== 'showing') return state
      return { ...state, phase: 'acked', answered: input.answer }
    // The server says this one was already settled. Same as finding it gone.
    case 'stale':
      if (state.current == null || state.phase === 'leaving') return state
      return { ...state, phase: 'leaving', answered: null }
    // Nothing moves. The card keeps the question and shows what went wrong.
    case 'failed':
      return state
    case 'timer':
      switch (state.phase) {
        case 'entering':
          return { ...state, phase: 'showing' }
        case 'acked':
          return { ...state, phase: 'leaving' }
        case 'leaving':
          return { ...state, current: null, phase: 'empty', answered: null }
        // The breath between two questions, and the wait for the first one.
        case 'empty':
          return state.queue.length === 0
            ? state
            : { current: state.queue[0], phase: 'entering', queue: state.queue.slice(1), answered: null }
        // Showing waits for you, not for a clock.
        default:
          return state
      }
  }
}

// How long each phase lasts. The hold and the breath are time, not motion, so
// they are the same however the reader feels about animation; only the fades
// shorten. `showing` has no duration - it ends when you answer.
function phaseMs(phase: LivePhase, reduced: boolean): number | null {
  switch (phase) {
    case 'entering':
      return reduced ? 150 : 400
    case 'acked':
      return 1600
    case 'leaving':
      return reduced ? 150 : 300
    case 'empty':
      return 300
    default:
      return null
  }
}

// -- The page -----------------------------------------------------------------

function LivePage() {
  useHeaderBack(<BackLink to="/pending" label="Needs you" />, [])
  useWakeLock()
  const reduced = useReducedMotion()
  const client = useQueryClient()
  const { data: pending, isError, refetch } = useQuery(pendingQuery())
  const [state, dispatch] = useReducer(liveQueue, LIVE_START)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // Every question waiting, as ids, in the order the server gave them.
  const ids = (pending ?? []).map((t) => t.pending_event_id).filter((id): id is string => !!id)
  const idsKey = ids.join(',')
  useEffect(() => {
    dispatch({ type: 'data', ids: idsKey ? idsKey.split(',') : [] })
  }, [idsKey])

  // The clock. One timer per phase, cleared on every change, so a phase that
  // is cut short by an answer or by the poll never fires the old one.
  const ms = phaseMs(state.phase, reduced)
  useEffect(() => {
    if (ms == null) return
    if (state.phase === 'empty' && state.queue.length === 0) return
    const t = setTimeout(() => dispatch({ type: 'timer' }), ms)
    return () => clearTimeout(t)
  }, [state.phase, state.current, state.queue.length, ms])

  // The body of the question. A TaskSummary carries the title and the
  // micro-answers, not the blocks, so a form question or a five-option one has
  // nothing to render from; the event has all of it.
  const current = state.current
  const { data: event } = useQuery({ ...eventQuery(current ?? ''), enabled: current != null })

  // The next one, fetched while this one is still up, so the swap never shows
  // a placeholder.
  const next = state.queue[0]
  useEffect(() => {
    if (next) void client.prefetchQuery(eventQuery(next))
  }, [next, client])

  // The card is pinned here rather than read straight off the query: answering
  // takes the question out of the pending list, and the acknowledgement and
  // the leave animation both happen after that.
  const [card, setCard] = useState<EventItem | null>(null)
  useEffect(() => {
    if (current == null) {
      setCard(null)
      return
    }
    if (event && event.id === current) setCard(event)
  }, [current, event])
  useEffect(() => setError(null), [current])

  async function submit(answer: Record<string, unknown>) {
    if (!card || sending) return
    const prepared = await prepareAnswer(card, answer)
    if (!prepared) return
    setError(null)
    setSending(true)
    try {
      const res = await api.answer(card.id, prepared.payload)
      if (res.ok) dispatch({ type: 'answered', answer: shortAnswer(prepared.display) })
      // "Question already answered." is not a failure worth stopping on: it is
      // settled, so the card leaves the way it would have if the poll had
      // brought the news first.
      else if (/^Question already /.test(res.error ?? '')) dispatch({ type: 'stale' })
      else {
        setError(res.error ?? 'Could not submit.')
        dispatch({ type: 'failed' })
      }
    } catch (e) {
      setError((e as Error).message || 'Could not submit.')
      dispatch({ type: 'failed' })
    } finally {
      setSending(false)
      void Promise.all(LIVE_KEYS.map((key) => client.invalidateQueries({ queryKey: key })))
    }
  }

  if (!pending && isError)
    return (
      <Stage>
        <InlineError message="Could not load what is waiting." onRetry={() => refetch()} />
      </Stage>
    )
  if (!pending) return <LiveSkeleton />

  return (
    <Stage>
      {card ? (
        <LiveCard
          key={card.id}
          e={card}
          phase={state.phase}
          answered={state.answered}
          sending={sending}
          error={error}
          waiting={state.queue.length}
          onSubmit={submit}
        />
      ) : state.queue.length === 0 ? (
        <EmptyQueue />
      ) : null}
    </Stage>
  )
}

// The card sits in the middle of what is left of the screen when it is shorter
// than that, and scrolls from the top when it is taller.
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100svh-3.25rem)] w-full max-w-[44rem] flex-col justify-center px-4 py-6">
      {children}
    </main>
  )
}

function LiveCard({
  e,
  phase,
  answered,
  sending,
  error,
  waiting,
  onSubmit,
}: {
  e: EventItem
  phase: LivePhase
  answered: string | null
  sending: boolean
  error: string | null
  waiting: number
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const { blocks, locked } = useQuestionContent(e)
  const settled = phase === 'acked' || phase === 'leaving'

  return (
    <div className={phase === 'entering' ? 'live-in' : phase === 'leaving' ? 'live-out' : undefined}>
      <div className="rounded-ui border border-edge bg-surface p-5">
        <div className="flex items-center gap-2 text-[15px] text-muted">
          <ProjectDot project={e.project ?? ''} size={6} />
          <span className="truncate">{projectLabel(e.project ?? '')}</span>
          {e.enc ? (
            <span className="inline-flex items-center gap-1 text-[13px] text-kind-done">
              <Lock size={12} aria-hidden /> encrypted
            </span>
          ) : null}
        </div>
        {e.task ? <div className="mt-1 text-[15px] text-muted">{e.task}</div> : null}
        <h1 className="mt-1 text-[22px] leading-tight font-semibold">{e.title}</h1>
        <div className="mt-1 text-[13px] text-faint">
          asked <Time at={e.created_at} long />
        </div>

        <div className="mt-4">{locked ? <LockedNote /> : <BlockRenderer blocks={blocks} />}</div>

        {locked ? null : (
          <div className="mt-4 border-t border-line pt-4">
            {settled ? (
              <Acknowledgement answer={answered ?? ''} ack={e.ack} />
            ) : (
              <AnswerArea blocks={blocks} disabled={sending} error={error} onSubmit={onSubmit} />
            )}
          </div>
        )}
      </div>
      {waiting > 0 ? (
        <p className="live-note mt-3 text-center text-[15px] text-faint">
          {waiting} more waiting
        </p>
      ) : null}
    </div>
  )
}

// What you just did, held on screen long enough to read. The agent's own word
// back to you goes under it when it sent one, in the same chip the thread uses.
function Acknowledgement({ answer, ack }: { answer: string; ack: string | null }) {
  return (
    <div className="live-note">
      <div className={`flex items-center gap-2 text-[17px] ${STATE_TEXT.answered}`}>
        <Check size={18} aria-hidden />
        <span>
          Answered: <span className="font-semibold">{answer}</span>
        </span>
      </div>
      {ack ? (
        <div className="mt-2">
          <Callout tone="success">{ack.replace(/\{answer\}/g, answer)}</Callout>
        </div>
      ) : null}
    </div>
  )
}

// Nothing waiting. Two lines, centred, and no button, no list, no picture. The
// connection dot in the header still says whether the hub is reachable, so
// this is never a lie about a dead connection.
function EmptyQueue() {
  return (
    <div className="live-calm px-4 text-center">
      <p className="text-[32px] leading-tight font-semibold">You&apos;re all caught up.</p>
      <p className="mt-3 text-[17px] text-muted">
        Your agents are working. The next question will appear here.
      </p>
      <p className="mt-8 text-[15px]">
        <Link to="/">Back to projects</Link>
      </p>
    </div>
  )
}

// -- Two things the browser is asked for --------------------------------------

// A calm screen that goes dark after thirty seconds is not one. Released when
// the tab is hidden and taken again when it comes back, because the browser
// drops the lock on its own either way.
function useWakeLock() {
  const held = useRef<{ release: () => Promise<void> } | null>(null)
  useEffect(() => {
    const lock = (
      navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
      }
    ).wakeLock
    if (!lock) return
    let live = true
    const take = async () => {
      if (document.visibilityState !== 'visible' || held.current) return
      try {
        const sentinel = await lock.request('screen')
        if (live) held.current = sentinel
        else void sentinel.release()
      } catch {
        // Denied, or the battery is low. The screen dims; nothing else changes.
      }
    }
    const drop = () => {
      void held.current?.release()
      held.current = null
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? void take() : drop())
    void take()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisibility)
      drop()
    }
  }, [])
}

// The CSS drops every transform on its own; the timers have to agree with it,
// or a card would sit finished and unread while its clock ran on.
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
