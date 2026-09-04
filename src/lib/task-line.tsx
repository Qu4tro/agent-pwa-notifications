import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { QueryKey } from '@tanstack/react-query'
import { type TaskSummary } from './api'
import { useAnswerFromList } from './queries'
import { answerStyles } from './answers'
import { shortAnswer } from './question'
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
  const newest = t.recent[t.recent.length - 1]
  const shown = t.task ? t.recent : t.recent.slice(0, -1)
  const items = shown
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      // The gutter is already showing the newest event's time; the same three
      // characters twice on one row says nothing the second time.
      at: r.id === newest?.id ? null : r.created_at,
      unread: r.read_at == null,
      answer: settled(r.question),
    }))
    .reverse()
  return { items, earlier: Math.max(0, t.count - t.recent.length) }
}

// A question line says what was decided, so a row does not stop at asking. A
// question still waiting says nothing extra: its buttons are the answer, and
// they are on the row.
//
// An encrypted answer is a ciphertext string here, and decrypting it would be
// one async hook per line of every list, so the row says that it was answered
// and not what. Nobody has yet said they miss the value.
function settled(
  q: TaskSummary['recent'][number]['question'],
): TimelineItem['answer'] {
  if (!q || q.status === 'pending') return null
  if (q.status === 'expired') return { status: 'expired', text: 'expired' }
  const text = typeof q.answer === 'string' ? 'answered' : shortAnswer(q.answer, q.text)
  return { status: 'answered', text: text || 'answered' }
}

export function TaskLine({
  t,
  unread,
  answers,
  from,
}: {
  t: TaskSummary
  unread?: boolean
  // What can be done to this thread from the list, if anything.
  answers?: React.ReactNode
  // Which list this row is in, when the thread's own URL cannot say it. The
  // thread page reads it to know where its way out goes.
  from?: 'pending'
}) {
  return (
    <Row time={<Time at={t.last_activity} />} answers={answers}>
      <Link
        to="/project/$name/task/$key"
        params={taskParams(t)}
        search={from ? { from } : {}}
        className={rowLinkClass}
      >
        <RowBody
          title={
            <span className="flex items-center gap-1.5">
              {unread ? <UnreadDot kind={t.latest_kind} /> : null}
              {/* A thread with no task label is titled by its newest event, and
                  that event is left off the timeline below - so the kind word
                  it would have carried there comes up here instead. */}
              {t.task ? null : <KindLabel kind={t.latest_kind} />}
              <span className="truncate">{t.task || t.latest_title}</span>
            </span>
          }
          timeline={timelineOf(t)}
          bold={unread || t.pending}
        />
      </Link>
    </Row>
  )
}

// A pending question keeps the same row and answers on it. Two or three short
// options ride along the row itself; anything larger - a form, a long option,
// an encrypted question - is the row on its own, and the row opens the thread
// where it can be answered.
//
// The buttons cannot sit inside the row's link, so they are a slot on the row
// beside it: a column of fixed width at the right, which they split in equal
// shares, and a full line of their own when the column does not fit.
//
// `queryKey` is the list this row is part of, so the optimistic write lands on
// the right cache entry: the project's tasks on one page, the pending list on
// the other.
export function PendingLine({
  t,
  queryKey,
  from,
}: {
  t: TaskSummary
  queryKey: QueryKey
  from?: 'pending'
}) {
  const answer = useAnswerFromList(queryKey)
  const [error, setError] = useState<string | null>(null)
  const options = t.pending_answers ?? []
  const eventId = t.pending_event_id

  function submit(value: Record<string, string>) {
    if (!eventId) return
    setError(null)
    answer.mutate({ eventId, answer: value }, { onError: (e) => setError((e as Error).message) })
  }

  if (options.length === 0 || !eventId) return <TaskLine t={t} from={from} />

  const styles = answerStyles(
    options.map((o) => o.label),
    options.map((o) => o.color),
  )

  return (
    <TaskLine
      t={t}
      from={from}
      answers={
        <>
          {options.map((o, i) => (
            <Button
              key={o.label}
              variant="answer"
              style={styles[i]}
              // flex-1 splits the column, or a wrapped line, into equal
              // shares; min-w-fit stops that split from squeezing a long
              // label into two lines, and lets the column widen for it.
              className="flex-1 min-w-fit whitespace-nowrap"
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
  )
}
