import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { QueryKey } from '@tanstack/react-query'
import { timeAgo, type TaskSummary } from './api'
import { useAnswerFromList } from './queries'
import { KIND_LABEL, KIND_TEXT, toParam } from './project'
import { Button, KindLabel, Row, RowBody, RowMeta, UnreadDot } from './ui'

// One thread, as a row. Both list pages render these: the project page, which
// shows every thread in one project, and the pending page, which shows the
// threads waiting on you across all of them. They are the same rows because
// they are the same thing - only the question of which ones is different.

function taskParams(t: TaskSummary) {
  return { name: toParam(t.project), key: t.key }
}

// What goes under the title of a task row. A pending question asks itself; any
// other thread lists what actually happened on it, one line per event, newest
// last. `count` still says how many there are in total, as the "+N earlier"
// line; the row no longer prints the bare number.
//
// The title of the row is the task label when the agent set one, and the
// newest event's own title when it did not, so in that second case the newest
// line is already the title and is left off rather than said twice.
export function detailLines(t: TaskSummary): React.ReactNode[] {
  if (t.pending) return t.pending_question ? [t.pending_question] : []

  const shown = t.task ? t.recent : t.recent.slice(0, -1)
  const earlier = t.count - t.recent.length
  const lines: React.ReactNode[] = []
  if (earlier > 0 && shown.length > 0) lines.push(<span className="text-faint">+{earlier} earlier</span>)
  for (const r of shown) {
    lines.push(
      // Unread keeps full-weight text, the same signal the row itself uses.
      <span className={r.read_at == null ? 'text-text' : undefined}>
        <span className={KIND_TEXT[r.kind] ?? 'text-muted'}>{KIND_LABEL[r.kind] ?? 'Event'}</span>{' '}
        {r.title}
      </span>,
    )
  }
  return lines
}

export function TaskLine({ t, unread, divider = true }: { t: TaskSummary; unread?: boolean; divider?: boolean }) {
  return (
    <Link
      to="/project/$name/task/$key"
      params={taskParams(t)}
      className="block text-text no-underline hover:bg-surface"
    >
      <Row divider={divider}>
        <KindLabel kind={t.pending ? 'question' : t.latest_kind} className="w-[5rem]" />
        <RowBody
          title={
            <span className="flex items-center gap-1.5">
              {unread ? <UnreadDot kind={t.latest_kind} /> : null}
              <span className="truncate">{t.task || t.latest_title}</span>
            </span>
          }
          detail={detailLines(t)}
          bold={unread || t.pending}
        />
        <RowMeta>
          <span>{timeAgo(t.last_activity)}</span>
        </RowMeta>
      </Row>
    </Link>
  )
}

// A pending question keeps the same row, and hangs its answer under it. Two or
// three short options are answered here; anything larger - a form, a long
// option, an encrypted question - is the row on its own, and the row opens the
// thread where it can be answered.
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
    <div className="border-b border-b-line">
      <TaskLine t={t} divider={false} />
      <div className="flex flex-wrap items-center gap-2 pr-4 pb-3 pl-[19px]">
        {options.map((o) => (
          <Button
            key={o.label}
            variant="primary"
            disabled={answer.isPending}
            onClick={() => submit(o.answer)}
          >
            {o.label}
          </Button>
        ))}
        {error ? <span className="text-[15px] text-kind-error">{error}</span> : null}
      </div>
    </div>
  )
}
