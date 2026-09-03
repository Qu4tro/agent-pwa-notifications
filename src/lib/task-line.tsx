import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { QueryKey } from '@tanstack/react-query'
import { type TaskSummary } from './api'
import { useAnswerFromList } from './queries'
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
    }))
    .reverse()
  return { items, earlier: Math.max(0, t.count - t.recent.length) }
}

export function TaskLine({
  t,
  unread,
  answers,
}: {
  t: TaskSummary
  unread?: boolean
  // What can be done to this thread from the list, if anything.
  answers?: React.ReactNode
}) {
  return (
    <Row time={<Time at={t.last_activity} />} answers={answers}>
      <Link to="/project/$name/task/$key" params={taskParams(t)} className={rowLinkClass}>
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
// beside it. They stay at the right while they fit and take a full line of
// their own, in equal shares, when they do not.
//
// `queryKey` is the list this row is part of, so the optimistic write lands on
// the right cache entry: the project's tasks on one page, the pending list on
// the other.
export function PendingLine({ t, queryKey }: { t: TaskSummary; queryKey: QueryKey }) {
  const answer = useAnswerFromList(queryKey)
  const [error, setError] = useState<string | null>(null)
  const options = t.pending_answers ?? []
  const eventId = t.pending_event_id

  function submit(value: Record<string, string>) {
    if (!eventId) return
    setError(null)
    answer.mutate({ eventId, answer: value }, { onError: (e) => setError((e as Error).message) })
  }

  if (options.length === 0 || !eventId) return <TaskLine t={t} />

  return (
    <TaskLine
      t={t}
      answers={
        <>
          {options.map((o) => (
            <Button
              key={o.label}
              variant="primary"
              // flex-1 splits a wrapped line into equal shares; min-w-fit
              // stops that split from squeezing the longest label into two
              // lines when the buttons are riding the row instead.
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
