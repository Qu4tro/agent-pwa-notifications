import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { timeAgo, type TaskSummary } from '../lib/api'
import { BackLink, Container, useHeaderActions, useHeaderBack } from '../lib/shell'
import { ensure, tasksQuery, useAnswerFromList, useArchive, useClear } from '../lib/queries'
import { TasksSkeleton } from '../lib/skeleton'
import { projectLabel, fromParam, KIND_LABEL, KIND_TEXT, STATE_TEXT } from '../lib/project'
import {
  Button,
  ConfirmPanel,
  InlineError,
  KindLabel,
  ProjectDot,
  Row,
  RowBody,
  RowMeta,
  Section,
  UnreadDot,
  iconButtonClass,
} from '../lib/ui'

export const Route = createFileRoute('/_app/project/$name/')({
  ssr: false,
  loader: ({ context, params }) =>
    context.signedIn
      ? ensure<TaskSummary[]>(context.queryClient, tasksQuery(fromParam(params.name)))
      : undefined,
  pendingComponent: TasksSkeleton,
  component: ProjectView,
})

function ProjectView() {
  const { name } = Route.useParams()
  const project = fromParam(name)
  const { data, isError, refetch } = useQuery(tasksQuery(project))
  const clear = useClear()
  const archive = useArchive(project)
  const [clearOpen, setClearOpen] = useState(false)

  useHeaderBack(<BackLink to="/" label="Projects" />, [])
  useHeaderActions(
    <button
      onClick={() => setClearOpen((v) => !v)}
      title="Clear project"
      aria-label="Clear project"
      className={`${iconButtonClass} ${clearOpen ? 'text-kind-error' : ''}`}
    >
      <Trash2 size={18} />
    </button>,
    [clearOpen],
  )

  function doClear(scope: 'read' | 'all') {
    setClearOpen(false)
    clear.mutate({ scope, project })
  }

  if (!data) {
    if (!isError) return <TasksSkeleton />
    return (
      <Container>
        <InlineError message="Could not load this project." onRetry={() => refetch()} />
      </Container>
    )
  }

  // The server decides which of these a thread is in. It used to be worked
  // out here, from "has the human read it", which is why a thread the agent
  // was still working on could sit under Done.
  const waiting = data.filter((t) => t.state === 'pending')
  const active = data.filter((t) => t.state === 'active')
  const done = data.filter((t) => t.state === 'done')

  return (
    <Container>
      <div className="mb-4 flex items-center gap-2 px-4">
        <ProjectDot project={project} />
        <h1 className="truncate text-[22px] font-semibold">{projectLabel(project)}</h1>
      </div>

      {clearOpen && (
        <ClearPanel
          onClear={doClear}
          onCancel={() => setClearOpen(false)}
          label={projectLabel(project)}
        />
      )}

      {data.length === 0 ? (
        <p className="px-4 py-12 text-center text-muted">No tasks in this project.</p>
      ) : (
        <>
          {waiting.length > 0 && (
            <Section title="Needs you" count={waiting.length}>
              {waiting.map((t) => (
                <PendingLine key={t.key} t={t} project={project} />
              ))}
            </Section>
          )}
          {active.length > 0 && (
            <Section title="Active" count={active.length}>
              {active.map((t) => (
                <TaskLine key={t.key} t={t} unread={t.unread > 0} />
              ))}
            </Section>
          )}
          {done.length > 0 && (
            <Section
              title="Done"
              count={done.length}
              // Archive, not delete: these threads leave the app and stay in
              // the database. What is on screen is what goes, so the keys go
              // with the request rather than the server deciding again.
              action={
                <button
                  type="button"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate({ keys: done.map((t) => t.key) })}
                  className="-my-1.5 inline-flex min-h-11 items-center rounded-ui px-2 text-[14px] text-muted hover:text-text disabled:opacity-50"
                >
                  Clear
                </button>
              }
            >
              {done.map((t) => (
                <TaskLine key={t.key} t={t} unread={t.unread > 0} />
              ))}
            </Section>
          )}
        </>
      )}
    </Container>
  )
}

function taskParams(t: TaskSummary) {
  return { name: t.project === '' ? '__none__' : t.project, key: t.key }
}

// What goes under the title of a task row. A pending question asks itself; any
// other thread lists what actually happened on it, one line per event, newest
// last - the count on the right used to be the only trace of the other two.
//
// The title of the row is the task label when the agent set one, and the
// newest event's own title when it did not, so in that second case the newest
// line is already the title and is left off rather than said twice.
function detailLines(t: TaskSummary): React.ReactNode[] {
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

function TaskLine({ t, unread, divider = true }: { t: TaskSummary; unread?: boolean; divider?: boolean }) {
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
          {t.count > 1 ? <span>{t.count}</span> : null}
          <span>{timeAgo(t.last_activity)}</span>
        </RowMeta>
      </Row>
    </Link>
  )
}

// A pending question keeps the same row, and hangs its answer under it. Two or
// three short options are answered here; anything larger is opened.
function PendingLine({ t, project }: { t: TaskSummary; project: string }) {
  const answer = useAnswerFromList(project)
  const [error, setError] = useState<string | null>(null)
  const options = t.pending_answers ?? []
  const eventId = t.pending_event_id

  function submit(value: Record<string, string>) {
    if (!eventId) return
    setError(null)
    answer.mutate({ eventId, answer: value }, { onError: (e) => setError((e as Error).message) })
  }

  return (
    <div className="border-b border-b-line">
      <TaskLine t={t} divider={false} />
      <div className="flex flex-wrap items-center gap-2 pr-4 pb-3 pl-[19px]">
        {options.length > 0 && eventId ? (
          options.map((o) => (
            <Button
              key={o.label}
              variant="primary"
              disabled={answer.isPending}
              onClick={() => submit(o.answer)}
            >
              {o.label}
            </Button>
          ))
        ) : (
          <Link
            to="/project/$name/task/$key"
            params={taskParams(t)}
            className={`text-[15px] no-underline hover:underline ${STATE_TEXT.pending}`}
          >
            Open to answer
          </Link>
        )}
        {error ? <span className="text-[15px] text-kind-error">{error}</span> : null}
      </div>
    </div>
  )
}

function ClearPanel({
  onClear,
  onCancel,
  label,
}: {
  onClear: (s: 'read' | 'all') => void
  onCancel: () => void
  label: string
}) {
  return (
    <ConfirmPanel
      className="mx-4 mb-4"
      actions={
        <>
          <Button onClick={() => onClear('read')}>Read and answered</Button>
          <Button variant="danger" onClick={() => onClear('all')}>
            Everything
          </Button>
          <Button className="ml-auto border-transparent text-muted" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      Clear "{label}". Only this project. This cannot be undone.
    </ConfirmPanel>
  )
}
