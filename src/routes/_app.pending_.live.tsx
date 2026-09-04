import { useEffect, useReducer, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Lock } from 'lucide-react'
import { api, type AnswerDoc, type EventItem, type TaskSummary } from '../lib/api'
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

// `empty` is the breath: nothing on screen, a timer running. `calm` is the
// "all caught up" line, which waits for a question the way `showing` waits for
// an answer. `leaving` with no current card is that line on its way out.
export type LivePhase = 'empty' | 'calm' | 'entering' | 'showing' | 'acked' | 'leaving'

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

// Where the page begins, given what was waiting when it opened: the first
// question already on its way in, or the calm line. The breath is for the gap
// between two things on the screen, and on arrival there was nothing before.
export function liveStart(ids: string[]): LiveState {
  return liveQueue({ ...LIVE_START, queue: ids }, { type: 'timer' })
}

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
      // The calm line was up. It goes first; the question follows it in.
      if (state.phase === 'calm' && queue.length > 0) return { ...state, phase: 'leaving', queue }
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
        // The breath is over: the next question, or the calm line.
        case 'empty':
          return state.queue.length === 0
            ? { ...state, phase: 'calm' }
            : { current: state.queue[0], phase: 'entering', queue: state.queue.slice(1), answered: null }
        // Showing waits for you, and calm waits for a question. Not for a clock.
        default:
          return state
      }
  }
}

// How long each phase lasts. The hold and the breath are time, not motion, so
// they are the same however the reader feels about animation; only the fades
// shorten. `showing` and `calm` have no duration - they end on an answer or a
// question. The clock decides state, never what is drawn: a card keeps its
// entrance animation until it leaves, so a timer that runs ahead of the
// browser cuts nothing short.
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
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // Every question waiting, as ids, in the order the server gave them.
  const ids = (pending ?? []).map((t) => t.pending_event_id).filter((id): id is string => !!id)
  const idsKey = ids.join(',')
  // The loader has already put the list in the cache, so the queue starts from
  // it rather than from nothing: the first card is on its way in on the first
  // paint, and the calm line never shows for a frame ahead of a full queue.
  // With no list at all - the load failed - it starts empty and still.
  const [state, dispatch] = useReducer(liveQueue, pending ? ids : undefined, (ids) =>
    ids ? liveStart(ids) : LIVE_START,
  )
  useEffect(() => {
    dispatch({ type: 'data', ids: idsKey ? idsKey.split(',') : [] })
  }, [idsKey])

  // The clock. One timer per phase, cleared on every change, so a phase that
  // is cut short by an answer or by the poll never fires the old one. It does
  // not run while the page has no list to draw from: the skeleton or the error
  // is up then, and a breath that ended behind them would settle into the
  // calm phase and later fade out a line nobody saw.
  const ms = pending ? phaseMs(state.phase, reduced) : null
  useEffect(() => {
    if (ms == null) return
    const t = setTimeout(() => dispatch({ type: 'timer' }), ms)
    return () => clearTimeout(t)
  }, [state.phase, state.current, state.queue.length, ms])

  // The body of the question. A TaskSummary carries the title and the
  // micro-answers, not the blocks, so a form question or a five-option one has
  // nothing to render from; the event has all of it. Read straight off the
  // query, in the same render that sets `current`: a card pinned in state
  // would lag one render behind and paint the wrong thing for a frame - the
  // last card at full opacity after its fade, or the calm line before the
  // next card. The event key is not among the ones an answer invalidates, so
  // the card is still here for the acknowledgement and the leave.
  const current = state.current
  const { data: event } = useQuery({ ...eventQuery(current ?? ''), enabled: current != null })
  const card = current != null && event?.id === current ? event : null

  // The next one, fetched while this one is still up, so the swap never shows
  // a placeholder.
  const next = state.queue[0]
  useEffect(() => {
    if (next) void client.prefetchQuery(eventQuery(next))
  }, [next, client])

  useEffect(() => setError(null), [current])

  async function submit(doc: AnswerDoc) {
    if (!card || sending) return
    // The live mode answers what is still waiting, so a card already settled
    // elsewhere leaves rather than being overwritten from here.
    const prepared = await prepareAnswer(card, doc, { ifPending: true })
    if (!prepared) return
    setError(null)
    setSending(true)
    try {
      const res = await api.answer(card.id, prepared.payload)
      if (res.ok)
        dispatch({
          type: 'answered',
          answer: shortAnswer(prepared.display.answer, prepared.display.text),
        })
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

  // A card whose body has not arrived yet draws nothing, never the calm line:
  // that line is a phase of its own, entered only once the queue is empty.
  const calm = current == null && (state.phase === 'calm' || state.phase === 'leaving')

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
      ) : calm ? (
        <EmptyQueue leaving={state.phase === 'leaving'} />
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
  onSubmit: (doc: AnswerDoc) => void
}) {
  const { blocks, locked } = useQuestionContent(e)
  const settled = phase === 'acked' || phase === 'leaving'

  // The entrance stays on the card for as long as it is up. Taking it off
  // when the clock says "showing" would snap the last frames of the rise, and
  // a card whose body came late would arrive with no rise at all.
  return (
    <div className={phase === 'leaving' ? 'live-out' : 'live-in'}>
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
          // One grid cell for both, so the answer area fades out under the
          // acknowledgement rather than making way for it: the card keeps its
          // height on the tap, and nothing on it moves.
          <div className="mt-4 grid border-t border-line pt-4">
            <div
              className={settled ? 'live-fade col-start-1 row-start-1' : 'col-start-1 row-start-1'}
              inert={settled}
            >
              <AnswerArea
                blocks={blocks}
                current={null}
                disabled={sending || settled}
                error={error}
                onSubmit={onSubmit}
              />
            </div>
            {settled ? (
              <div className="col-start-1 row-start-1">
                <Acknowledgement answer={answered ?? ''} ack={e.ack} />
              </div>
            ) : null}
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
// this is never a lie about a dead connection. When a question arrives the
// lines fade out first, and the card rises into the space they leave.
function EmptyQueue({ leaving }: { leaving: boolean }) {
  return (
    <div className={`${leaving ? 'live-out' : 'live-calm'} px-4 text-center`}>
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
