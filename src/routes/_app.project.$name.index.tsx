import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { timeAgo, type TaskSummary } from '../lib/api'
import { BackLink, Container, useHeaderActions } from '../lib/shell'
import { ensure, tasksQuery, useAnswerFromList, useClear } from '../lib/queries'
import { TasksSkeleton } from '../lib/skeleton'
import { projectLabel, fromParam, STATE_TEXT } from '../lib/project'
import {
  Button,
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
  const [clearOpen, setClearOpen] = useState(false)

  useHeaderActions(
    <>
      <button
        onClick={() => setClearOpen((v) => !v)}
        title="Clear project"
        aria-label="Clear project"
        className={`${iconButtonClass} ${clearOpen ? 'text-kind-error' : ''}`}
      >
        <Trash2 size={16} />
      </button>
      <BackLink to="/" label="Projects" />
    </>,
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

  const waiting = data.filter((t) => t.pending)
  const others = data.filter((t) => !t.pending)
  const active = others.filter((t) => t.unread > 0)
  const done = others.filter((t) => t.unread === 0)

  return (
    <Container>
      <div className="mb-3 flex items-center gap-2 px-3">
        <ProjectDot project={project} />
        <h1 className="truncate text-[17px] font-semibold">{projectLabel(project)}</h1>
      </div>

      {clearOpen && (
        <ClearPanel
          onClear={doClear}
          onCancel={() => setClearOpen(false)}
          label={projectLabel(project)}
        />
      )}

      {data.length === 0 ? (
        <p className="px-3 py-10 text-center text-muted">No tasks in this project.</p>
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
            <Section title="Active">
              {active.map((t) => (
                <TaskLine key={t.key} t={t} unread />
              ))}
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Done" count={done.length}>
              {done.map((t) => (
                <TaskLine key={t.key} t={t} />
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

function TaskLine({ t, unread, divider = true }: { t: TaskSummary; unread?: boolean; divider?: boolean }) {
  return (
    <Link
      to="/project/$name/task/$key"
      params={taskParams(t)}
      className="block text-text no-underline hover:bg-surface"
    >
      <Row divider={divider}>
        <KindLabel kind={t.pending ? 'question' : t.latest_kind} className="w-[4.5rem]" />
        <RowBody
          title={
            <span className="flex items-center gap-1.5">
              {unread ? <UnreadDot kind={t.latest_kind} /> : null}
              <span className="truncate">{t.task || t.latest_title}</span>
            </span>
          }
          detail={t.pending ? t.pending_question : t.task ? t.latest_title : null}
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
      <div className="flex flex-wrap items-center gap-2 pr-3 pb-2 pl-[15px]">
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
            className={`text-[13px] no-underline hover:underline ${STATE_TEXT.pending}`}
          >
            Open to answer
          </Link>
        )}
        {error ? <span className="text-[13px] text-kind-error">{error}</span> : null}
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
    <div className="mb-4 border-y border-line px-3 py-2">
      <p className="mb-2 text-[13px] text-muted">
        Clear "{label}". Only this project. This cannot be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onClear('read')}>Read and answered</Button>
        <Button variant="danger" onClick={() => onClear('all')}>
          Everything
        </Button>
        <Button className="ml-auto border-transparent text-muted" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
