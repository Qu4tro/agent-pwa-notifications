import { useEffect, useReducer, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { api, type AnswerDoc, type EventItem, type TaskSummary } from '../lib/api'
import { ensure, eventQuery, pendingQuery, queryKeys, LIVE_KEYS } from '../lib/queries'
import { LiveSkeleton } from '../lib/skeleton'
import { BlockRenderer, Callout } from '../lib/blocks'
import {
  AnswerArea,
  AnswerStatus,
  ChangeAnswer,
  answerRowClass,
  LockedNote,
  prepareAnswer,
  shortAnswer,
  useQuestionContent,
} from '../lib/question'
import { projectLabel, STATE_TEXT } from '../lib/project'
import { IconButton, InlineError, ProjectDot, Time } from '../lib/ui'

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

// -- The strip ----------------------------------------------------------------

// The page is a strip of cards with a cursor. Cards this page saw settle sit
// behind the cursor; the questions still waiting sit ahead of it. The edge is
// where the two meet: it is where the page starts, and where it returns after
// every answer.

// `empty` is the breath: nothing on screen, a timer running. `calm` is the
// "all caught up" line, which waits for a question the way `showing` waits for
// an answer. `leaving` with no current card is that line on its way out.
export type LivePhase = 'empty' | 'calm' | 'entering' | 'showing' | 'acked' | 'leaving'

// How the card on screen arrived, or how it goes: up from the queue, or
// sideways along the strip.
export type LiveMotion = 'rise' | 'back' | 'forward'

export interface LiveState {
  // The question on screen, or null when nothing is.
  current: string | null
  phase: LivePhase
  motion: LiveMotion
  // Cards this page saw settle, oldest first.
  behind: string[]
  // Waiting, oldest first, minus the card on screen and everything behind.
  queue: string[]
  // The answer just given, held for as long as the acknowledgement is up.
  answered: string | null
  // Where a navigation lands once the card on screen has left.
  destination: string | 'edge' | null
}

export type LiveInput =
  | { type: 'data'; ids: string[] }
  | { type: 'answered'; answer: string }
  | { type: 'failed' }
  | { type: 'stale' }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'timer' }

export const LIVE_START: LiveState = {
  current: null,
  phase: 'empty',
  motion: 'rise',
  behind: [],
  queue: [],
  answered: null,
  destination: null,
}

// The cursor is at the edge when the card on screen is not one of the ones
// already settled - so also when there is no card at all.
export function atEdge(s: LiveState): boolean {
  return s.current === null || !s.behind.includes(s.current)
}

// Where the page begins, given what was waiting when it opened: the first
// question already on its way in, or the calm line. The breath is for the gap
// between two things on the screen, and on arrival there was nothing before.
export function liveStart(ids: string[]): LiveState {
  return liveQueue({ ...LIVE_START, queue: ids }, { type: 'timer' })
}

// The whole of the mode's behaviour, as one pure function. Nothing here knows
// about React, a clock or the network: the page turns a poll, a tap, an arrow
// and an expired timer into these inputs and paints whatever comes back.
export function liveQueue(state: LiveState, input: LiveInput): LiveState {
  switch (input.type) {
    case 'data': {
      // FIFO with no sort of its own: getPending already returns oldest first,
      // and anything that has left the data has been answered or has expired.
      // A card behind the cursor is settled, so it is never in the data; that
      // is what keeps looking back untouched by the poll.
      const queue = input.ids.filter((id) => id !== state.current && !state.behind.includes(id))
      const gone = state.current != null && !input.ids.includes(state.current)
      // The card at the edge settled somewhere else - the phone, another tab,
      // a timeout. It has nothing to acknowledge, so it leaves without one.
      if (gone && atEdge(state) && (state.phase === 'entering' || state.phase === 'showing'))
        return { ...state, phase: 'leaving', answered: null, destination: null, queue }
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
      return { ...state, phase: 'leaving', answered: null, destination: null }
    // Nothing moves. The card keeps the question and shows what went wrong.
    case 'failed':
      return state
    // One step older along the strip. The calm line can be stepped back from
    // too, so a last answer is still readable once the queue has run out.
    case 'back': {
      if (state.phase !== 'showing' && state.phase !== 'calm') return state
      const at = state.current == null ? -1 : state.behind.indexOf(state.current)
      const destination = at === -1 ? state.behind[state.behind.length - 1] : state.behind[at - 1]
      if (destination == null) return state
      // A card at the edge is still waiting, so stepping off it puts it back at
      // the head of the queue: coming forward again lands on the same question.
      const queue =
        at === -1 && state.current != null ? [state.current, ...state.queue] : state.queue
      return { ...state, phase: 'leaving', motion: 'back', answered: null, destination, queue }
    }
    // One step newer. From the last card behind the cursor that is the edge,
    // which is the queue again.
    case 'forward': {
      if (state.phase !== 'showing' || state.current == null) return state
      const at = state.behind.indexOf(state.current)
      if (at === -1) return state
      const destination = at === state.behind.length - 1 ? 'edge' : state.behind[at + 1]
      return { ...state, phase: 'leaving', motion: 'forward', answered: null, destination }
    }
    case 'timer':
      switch (state.phase) {
        case 'entering':
          return { ...state, phase: 'showing' }
        case 'acked':
          return { ...state, phase: 'leaving' }
        case 'leaving': {
          // A navigation lands straight on its card, with no breath between:
          // the strip is one surface, and a gap in it would read as an answer.
          if (state.destination === 'edge')
            return state.queue.length === 0
              ? { ...state, current: null, phase: 'calm', answered: null, destination: null }
              : {
                  ...state,
                  current: state.queue[0],
                  phase: 'entering',
                  queue: state.queue.slice(1),
                  answered: null,
                  destination: null,
                }
          if (state.destination != null)
            return {
              ...state,
              current: state.destination,
              phase: 'entering',
              answered: null,
              destination: null,
            }
          // Nowhere to go: the card settled, so it joins the strip behind the
          // cursor and the breath begins.
          const behind =
            state.current != null && !state.behind.includes(state.current)
              ? [...state.behind, state.current]
              : state.behind
          return { ...state, current: null, phase: 'empty', behind, answered: null }
        }
        // The breath is over: the next question, or the calm line.
        case 'empty':
          return state.queue.length === 0
            ? { ...state, phase: 'calm' }
            : {
                ...state,
                current: state.queue[0],
                phase: 'entering',
                motion: 'rise',
                queue: state.queue.slice(1),
                answered: null,
              }
        // Showing waits for you, and calm waits for a question. Not for a clock.
        default:
          return state
      }
  }
}

// Where the cursor stands on the strip, as "{at} of {of}". Null while the calm
// line is up at the edge: there is nothing to count.
export function livePosition(s: LiveState): { at: number; of: number } | null {
  const at = s.current == null ? -1 : s.behind.indexOf(s.current)
  if (at !== -1) {
    // The calm line takes the last slot only when nothing is waiting, so the
    // total never shrinks as the queue empties.
    return { at: at + 1, of: s.behind.length + Math.max(s.queue.length, 1) }
  }
  if (s.current == null) return null
  return { at: s.behind.length + 1, of: s.behind.length + 1 + s.queue.length }
}

// How long each phase lasts. The hold and the breath are time, not motion, so
// they are the same however the reader feels about animation; only the fades
// shorten. A step along the strip is shorter than a card rising out of the
// queue: it is one surface sliding, not a new thing arriving. `showing` and
// `calm` have no duration - they end on an answer, a question or an arrow. The
// clock decides state, never what is drawn: a card keeps its entrance
// animation until it leaves, so a timer that runs ahead of the browser cuts
// nothing short.
function phaseMs(phase: LivePhase, reduced: boolean, motion: LiveMotion): number | null {
  const sideways = motion === 'back' || motion === 'forward'
  switch (phase) {
    case 'entering':
      return sideways ? (reduced ? 150 : 250) : reduced ? 150 : 400
    case 'acked':
      return 1600
    case 'leaving':
      return sideways ? 150 : reduced ? 150 : 300
    case 'empty':
      return 300
    default:
      return null
  }
}

// -- The page -----------------------------------------------------------------

function LivePage() {
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
  const ms = pending ? phaseMs(state.phase, reduced, state.motion) : null
  useEffect(() => {
    if (ms == null) return
    const t = setTimeout(() => dispatch({ type: 'timer' }), ms)
    return () => clearTimeout(t)
  }, [state.phase, state.current, state.queue.length, ms])

  // The arrows on the keyboard walk the strip, so a desk screen needs no
  // pointer. A field takes its own arrow keys, and a modifier belongs to the
  // browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') dispatch({ type: 'back' })
      else if (e.key === 'ArrowRight') dispatch({ type: 'forward' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // The body of the question. A TaskSummary carries the title and the
  // micro-answers, not the blocks, so a form question or a five-option one has
  // nothing to render from; the event has all of it. Read straight off the
  // query, in the same render that sets `current`: a card pinned in state
  // would lag one render behind and paint the wrong thing for a frame - the
  // last card at full opacity after its fade, or the calm line before the
  // next card. The event key is not among the ones an answer invalidates, so
  // the card is still here for the acknowledgement and the leave.
  const current = state.current
  // A card behind the cursor keeps following the agent: the status line under
  // it turns to "received" when the agent collects the answer.
  const { data: event } = useQuery({
    ...eventQuery(current ?? ''),
    enabled: current != null,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const card = current != null && event?.id === current ? event : null

  // A card that has just joined the strip was answered a moment ago, so its
  // cached row is behind the server. The cached row stays, so looking back
  // paints at once and the refresh lands under it.
  const behindKey = state.behind.join(',')
  useEffect(() => {
    const last = behindKey ? behindKey.split(',').pop() : undefined
    if (last) void client.invalidateQueries({ queryKey: queryKeys.event(last) })
  }, [behindKey, client])

  // The next one, fetched while this one is still up, so the swap never shows
  // a placeholder.
  const next = state.queue[0]
  useEffect(() => {
    if (next) void client.prefetchQuery(eventQuery(next))
  }, [next, client])

  useEffect(() => setError(null), [current])

  async function submit(doc: AnswerDoc) {
    if (!card || sending) return
    // A card at the edge is still waiting, so it answers only while it is: one
    // settled elsewhere leaves rather than being overwritten from here. A card
    // behind the cursor is already answered, and this is how it is changed.
    const prepared = await prepareAnswer(card, doc, { ifPending: atEdge(state) })
    if (!prepared) return
    setError(null)
    setSending(true)
    try {
      const res = await api.answer(card.id, prepared.payload)
      if (res.ok) {
        // Write the document into the card's own row before it leaves, so
        // looking back at it shows what stands rather than what it replaced.
        client.setQueryData<EventItem | null>(queryKeys.event(card.id), (e) =>
          e && e.question
            ? {
                ...e,
                question: {
                  ...e.question,
                  status: 'answered',
                  answer: prepared.display.answer,
                  text: prepared.display.text,
                  answered_at: Date.now(),
                  changes:
                    e.question.status === 'answered' ? e.question.changes + 1 : e.question.changes,
                  picked_up_at: null,
                },
              }
            : e,
        )
        dispatch({
          type: 'answered',
          answer: shortAnswer(prepared.display.answer, prepared.display.text),
        })
      }
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

  const position = livePosition(state)
  const cursor = current == null ? -1 : state.behind.indexOf(current)
  const walk = (
    <Cursor
      position={position}
      canGoBack={state.behind.length > 0 && cursor !== 0}
      canGoForward={cursor !== -1}
      onBack={() => dispatch({ type: 'back' })}
      onForward={() => dispatch({ type: 'forward' })}
    />
  )

  return (
    <Stage>
      {card ? (
        <LiveCard
          key={card.id}
          e={card}
          phase={state.phase}
          motion={state.motion}
          answered={state.answered}
          sending={sending}
          error={error}
          onSubmit={submit}
          footer={walk}
        />
      ) : calm ? (
        <EmptyQueue leaving={state.phase === 'leaving'} footer={walk} />
      ) : null}
    </Stage>
  )
}

// The strip's own control: one step older, where you are, one step newer. The
// position replaces a count of what is waiting, because it says both - which
// card this is, and how many there are.
function Cursor({
  position,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  position: { at: number; of: number } | null
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
}) {
  // The calm line counts nothing and has nothing ahead of it, so it carries the
  // back arrow alone: a way to the last answer, and no numbers to read.
  if (!position)
    return canGoBack ? (
      <div className="live-note mt-3 flex justify-center">
        <IconButton aria-label="Back" onClick={onBack}>
          <ChevronLeft size={18} aria-hidden />
        </IconButton>
      </div>
    ) : null

  return (
    <div className="live-note mt-3 flex items-center justify-center gap-1">
      <IconButton
        aria-label="Back"
        disabled={!canGoBack}
        onClick={onBack}
        className="disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft size={18} aria-hidden />
      </IconButton>
      <span className="min-w-16 text-center text-[15px] text-faint">
        {`${position.at} of ${position.of}`}
      </span>
      <IconButton
        aria-label="Forward"
        disabled={!canGoForward}
        onClick={onForward}
        className="disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight size={18} aria-hidden />
      </IconButton>
    </div>
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

// How the card moves. Going back, the card on screen slides out to the right
// and the older one slides in from the left; going forward, the reverse.
function motionClass(phase: LivePhase, motion: LiveMotion): string {
  const going = phase === 'leaving'
  if (motion === 'back') return going ? 'live-out-back' : 'live-in-back'
  if (motion === 'forward') return going ? 'live-out-forward' : 'live-in-forward'
  return going ? 'live-out' : 'live-in'
}

function LiveCard({
  e,
  phase,
  motion,
  answered,
  sending,
  error,
  onSubmit,
  footer,
}: {
  e: EventItem
  phase: LivePhase
  motion: LiveMotion
  answered: string | null
  sending: boolean
  error: string | null
  onSubmit: (doc: AnswerDoc) => void
  footer: React.ReactNode
}) {
  const { blocks, answer, text, locked } = useQuestionContent(e)
  const q = e.question
  const settled = phase === 'acked' || phase === 'leaving'
  // Per card, and the card is keyed by its id, so stepping along the strip
  // never carries an open composer onto the next question.
  const [correcting, setCorrecting] = useState(false)
  // An answer given on this card, right now: `answered` is set on the tap and
  // cleared by any navigation. While it stands the area keeps the composer it
  // had, so the card does not shrink to a one-line summary under the
  // acknowledgement rising over it - the whole point of the grid below is that
  // nothing moves on the tap. A card walked back to has `answered` null and
  // collapses like any other.
  const acking = answered != null
  // A card looked at again stands on the answer it holds, so the controls open
  // on it and a second submit is a correction of what is there.
  const current: AnswerDoc | null =
    q?.status === 'answered'
      ? { answer: (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>, text }
      : null

  // The entrance stays on the card for as long as it is up. Taking it off
  // when the clock says "showing" would snap the last frames of the rise, and
  // a card whose body came late would arrive with no rise at all.
  return (
    <div className={motionClass(phase, motion)}>
      <div className="ui-card rounded-ui border border-edge bg-surface p-5">
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

        {locked ? null : q?.status === 'expired' ? (
          <div className={`mt-4 border-t border-line pt-4 text-[15px] ${STATE_TEXT.expired}`}>
            Expired before you answered.
          </div>
        ) : (
          // One grid cell for both, so the answer area fades out under the
          // acknowledgement rather than making way for it: the card keeps its
          // height on the tap, and nothing on it moves.
          <div className="mt-4 grid border-t border-line pt-4">
            <div
              className={settled ? 'live-fade col-start-1 row-start-1' : 'col-start-1 row-start-1'}
              inert={settled}
            >
              <div className="flex flex-col gap-3">
                {/* A card walked back to has no summary line above it the way
                    a thread message does, so it says what stands itself - and
                    the way to change it goes on the end of that line, as it
                    does in a thread. */}
                {current && !correcting && !acking ? (
                  <div className={`${answerRowClass} bg-bg text-[15px] ${STATE_TEXT.answered}`}>
                    <span className="min-w-0 flex-1">
                      You answered:{' '}
                      <span className="font-semibold">{shortAnswer(answer, text)}</span>
                    </span>
                    <ChangeAnswer
                      disabled={sending || settled}
                      onClick={() => setCorrecting(true)}
                    />
                  </div>
                ) : null}
                <AnswerArea
                  blocks={blocks}
                  current={current}
                  disabled={sending || settled}
                  error={error}
                  correcting={correcting}
                  onCorrecting={setCorrecting}
                  holdOpen={acking}
                  onSubmit={onSubmit}
                />
                {q ? <AnswerStatus question={q} answer={answer} text={text} ack={null} /> : null}
              </div>
            </div>
            {settled ? (
              <div className="col-start-1 row-start-1">
                <Acknowledgement answer={answered ?? ''} ack={e.ack} />
              </div>
            ) : null}
          </div>
        )}
      </div>
      {footer}
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
function EmptyQueue({ leaving, footer }: { leaving: boolean; footer: React.ReactNode }) {
  return (
    <div className={leaving ? 'live-out' : 'live-calm'}>
      <div className="px-4 text-center">
        <p className="text-[32px] leading-tight font-semibold">You&apos;re all caught up.</p>
        <p className="mt-3 text-[17px] text-muted">
          Your agents are working. The next question will appear here.
        </p>
      </div>
      {footer}
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
