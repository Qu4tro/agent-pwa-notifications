import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { type AnswerDoc, type EventItem, type TaskSummary } from './api'
import { threadQuery, useAnswer, useAnswerFromList } from './queries'
import { answerOrder, answerStyles } from './answers'
import { MessageModal, ThreadLink } from './message-modal'
import { prepareAnswer, shortAnswer, useQuestionContent } from './question'
import { toParam } from './project'
import { Button, KindLabel, Row, RowBody, Time, UnreadDot, rowLinkClass, type TimelineItem } from './ui'

// One thread, as a row. Both list pages render these: the project page, which
// shows every thread in one project, and the pending page, which shows the
// threads waiting on you across all of them. They are the same rows because
// they are the same thing - only the question of which ones is different.

function taskParams(t: TaskSummary) {
  return { name: toParam(t.project), key: t.key }
}

// What goes under the title of a task row: what actually happened on the
// thread, newest first, one line per event. A pending question used to replace
// that list with itself, which hid the thread's history and made the rows that
// need you the only ones on the page that read differently. It is the newest
// event on its thread, so the list already starts with it.
//
// The title of the row is the task label when the agent set one, and the
// newest event's own title when it did not, so in that second case the newest
// line is already the title and is left off rather than said twice.
export function timelineOf(t: TaskSummary): { items: TimelineItem[]; earlier: number } {
  const shown = t.task ? t.recent : t.recent.slice(0, -1)
  const items = shown
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      unread: r.read_at == null,
      answer: settled(r.question),
    }))
    .reverse()
  return { items, earlier: Math.max(0, t.count - t.recent.length) }
}

// A question line says what was decided, so a row does not stop at asking.
// A pending question says it needs one, so the timeline reads as open.
//
// An encrypted answer is a ciphertext string here, and decrypting it would be
// one async hook per line of every list, so the row says that it was answered
// and not what. Nobody has yet said they miss the value.
function settled(
  q: TaskSummary['recent'][number]['question'],
): TimelineItem['answer'] {
  if (!q) return null
  if (q.status === 'pending') return { status: 'pending', text: 'needs answer' }
  if (q.status === 'expired') return { status: 'expired', text: 'expired' }
  const text = typeof q.answer === 'string' ? 'answered' : shortAnswer(q.answer, q.text)
  return { status: 'answered', text: text || 'answered' }
}

export function TaskLine({
  t,
  unread,
  question,
  answers,
  onOpen,
  bodyRef,
}: {
  t: TaskSummary
  unread?: boolean
  // The question this row is asking, in full. Given on a row that is waiting
  // on you: the row then reads as one decision - title, question, and the
  // answers when they fit on it - and carries no timeline, because the
  // question is what the timeline's first line would have said, and the rest
  // of the thread is one tap away. Its history is not what the row is for.
  question?: string
  // What can be done to this thread from the list, if anything.
  answers?: React.ReactNode
  // Given on a row that opens its question over the list. The whole row then
  // opens it, and the body is a button and not a link to the thread; the way
  // to the thread moves to a control at the row's right, so it stays one tap
  // away.
  onOpen?: () => void
  // The button the body is, for whatever opens to give focus back to.
  bodyRef?: React.RefObject<HTMLButtonElement | null>
}) {
  // A thread with no task label is titled by its newest event. On a decision
  // row that event is the question, which is there in full already, so the
  // row has no title line and the question is its head. On any other row the
  // kind word the newest event would have carried on the timeline comes up
  // into the title instead.
  const title =
    t.task || question == null ? (
      <span className="flex items-center gap-1.5">
        {unread ? <UnreadDot kind={t.latest_kind} /> : null}
        {t.task ? null : <KindLabel kind={t.latest_kind} />}
        <span className="truncate">{t.task || t.latest_title}</span>
      </span>
    ) : undefined
  const body = (
    <RowBody
      title={title}
      question={question}
      timeline={question == null ? timelineOf(t) : undefined}
      bold={unread || t.pending}
      phrasing={onOpen != null}
    />
  )
  return (
    <Row
      time={<Time at={t.last_activity} />}
      answers={answers}
      trailing={onOpen ? <ThreadLink thread={{ project: t.project, key: t.key }} /> : undefined}
      onClick={onOpen}
    >
      {onOpen ? (
        <button
          ref={bodyRef}
          type="button"
          aria-haspopup="dialog"
          onClick={onOpen}
          className={`${rowLinkClass} cursor-pointer text-left`}
        >
          {body}
        </button>
      ) : (
        <Link to="/project/$name/task/$key" params={taskParams(t)} className={rowLinkClass}>
          {body}
        </Link>
      )}
    </Row>
  )
}

// A pending question keeps the same row and answers on it. Two or three short
// options stand under the question, which the row says in full, so the row
// reads as one decision; anything larger - a form, a long option, an encrypted
// question - is the same row with the question and no buttons. Neither says
// "needs answer": the section the row is in already does.
//
// The row's body opens the question over the list - the whole message, and
// the composer for whatever the buttons could not carry - rather than going
// to the thread, which is where every other row goes. Answering is what a
// waiting row is for, and the thread is the long way round to it; the thread
// is the control at the row's right instead.
//
// The buttons cannot sit inside the row's body, so they are a slot on the row
// under it. Each is at least 44px tall and 5rem wide whatever its label says,
// because a control on a phone is a thumb's target, and three of them still
// fit on one line of a 360px screen.
//
// `queryKey` is the list this row is part of, so the optimistic write lands on
// the right cache entry: the project's tasks on one page, the pending list on
// the other.
export function PendingLine({
  t,
  queryKey,
  open,
  onOpen,
  onClose,
}: {
  t: TaskSummary
  queryKey: QueryKey
  // Whether this row's question is the one open over the list, and the page's
  // way in and out of it: the page holds which one is open, in the address.
  // A row given none of these goes to the thread like any other.
  open?: boolean
  onOpen?: (eventId: string) => void
  onClose?: () => void
}) {
  const answer = useAnswerFromList(queryKey)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLButtonElement>(null)
  const sent = t.pending_answers ?? []
  const eventId = t.pending_event_id

  function submit(value: Record<string, string>) {
    if (!eventId) return
    setError(null)
    answer.mutate({ eventId, answer: value }, { onError: (e) => setError((e as Error).message) })
  }

  const question = t.pending_question ?? t.latest_title
  const opens = eventId && onOpen ? () => onOpen(eventId) : undefined
  const modal =
    open && eventId && onClose ? (
      <PendingModal t={t} eventId={eventId} row={body} onClose={onClose} />
    ) : null
  if (sent.length === 0 || !eventId)
    return (
      <>
        <TaskLine t={t} question={question} onOpen={opens} bodyRef={body} />
        {modal}
      </>
    )

  // In the app's order, not the agent's: an affirmative first, a denial last.
  const options = answerOrder(sent.map((o) => o.label)).map((i) => sent[i])
  const styles = answerStyles(
    options.map((o) => o.label),
    options.map((o) => o.color),
  )

  return (
    <>
      <TaskLine
        t={t}
        question={question}
        onOpen={opens}
        bodyRef={body}
        answers={
          <>
            {options.map((o, i) => (
              <Button
                key={o.label}
                variant="answer"
                style={styles[i]}
                className="min-w-20 whitespace-nowrap"
                disabled={answer.isPending}
                onClick={() => submit(o.answer)}
              >
                {o.label}
              </Button>
            ))}
            {/* Its own line under the buttons, whichever line those ended up on. */}
            {error ? (
              <span className="basis-full text-[15px] text-kind-error">{error}</span>
            ) : null}
          </>
        }
      />
      {modal}
    </>
  )
}

// The question a waiting row is asking, opened over the list: the same modal
// the thread opens its rows into, on the same event. The list carries only
// the question's first line and its quick answers, so the event comes from
// the thread, fetched when the modal opens and warm after that for the thread
// link beside the row.
function PendingModal({
  t,
  eventId,
  row,
  onClose,
}: {
  t: TaskSummary
  eventId: string
  row: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const { data: thread } = useQuery(threadQuery(t.project, t.key))
  const e = thread?.events.find((x) => x.id === eventId)
  // A thread that came back without the event - cleared under the row - has
  // nothing to open, so the modal goes the way Close would take it.
  useEffect(() => {
    if (thread !== undefined && !e) onClose()
  }, [thread, e, onClose])
  return e ? <PendingQuestion e={e} t={t} row={row} onClose={onClose} /> : null
}

function PendingQuestion({
  e,
  t,
  row,
  onClose,
}: {
  e: EventItem
  t: TaskSummary
  row: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const answer = useAnswer(t.project, t.key)
  const content = useQuestionContent(e)
  const [error, setError] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)

  // Sent with the same guard the row's buttons use, so a tap here loses to an
  // answer already given somewhere else rather than replacing it. Once it has
  // gone through, the modal closes and the row leaves the list with it, the
  // way a row's own buttons take it; what stands, and where it got to, are on
  // the thread. A submit that failed stays open, with the words under the
  // composer.
  async function submit(doc: AnswerDoc) {
    const prepared = await prepareAnswer(e, doc, { ifPending: e.question?.status === 'pending' })
    if (!prepared) return
    setError(null)
    try {
      await answer.mutateAsync({ eventId: e.id, payload: prepared.payload, display: prepared.display })
    } catch (err) {
      setError((err as Error).message || 'Could not submit.')
      return
    }
    onClose()
  }

  return (
    <MessageModal
      e={e}
      content={content}
      row={row}
      submitting={answer.isPending}
      error={error}
      correcting={correcting}
      onCorrecting={setCorrecting}
      onClose={onClose}
      onSubmit={submit}
      thread={{ project: t.project, key: t.key }}
    />
  )
}
