import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import type { TaskSummary } from '../lib/api'
import { Container, useHeaderActions } from '../lib/shell'
import { ensure, queryKeys, tasksQuery, useArchive, useClear } from '../lib/queries'
import { TasksSkeleton } from '../lib/skeleton'
import { PendingLine, TaskLine } from '../lib/task-line'
import { messageSearch, useMessageModal } from '../lib/message-modal'
import { projectLabel, fromParam } from '../lib/project'
import { Button, ConfirmPanel, InlineError, ProjectDot, Section, iconButtonClass } from '../lib/ui'

export const Route = createFileRoute('/_app/project/$name/')({
  ssr: false,
  // Which waiting row's question is open over the list, if one is: ?msg=, as
  // on the thread page.
  validateSearch: messageSearch,
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
  const { msg } = Route.useSearch()
  const modal = useMessageModal(msg, Route.useNavigate())
  const clear = useClear()
  const archive = useArchive(project)
  const [clearOpen, setClearOpen] = useState(false)

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
                <PendingLine
                  key={t.key}
                  t={t}
                  queryKey={queryKeys.tasks(project)}
                  open={msg != null && msg === t.pending_event_id}
                  onOpen={modal.open}
                  onClose={modal.close}
                />
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
