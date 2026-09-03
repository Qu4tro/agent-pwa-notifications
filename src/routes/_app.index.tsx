import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import type { ProjectRow } from '../lib/api'
import { Container, useHeaderActions } from '../lib/shell'
import { ensure, projectsQuery } from '../lib/queries'
import { ProjectsSkeleton } from '../lib/skeleton'
import { projectLabel, toParam, STATE_TEXT } from '../lib/project'
import { InlineError, ProjectDot, Row, RowBody, Section, Time, iconButtonClass } from '../lib/ui'

export const Route = createFileRoute('/_app/')({
  ssr: false,
  loader: ({ context }) =>
    // A signed-out visitor is on the way to /login; there is nothing to fetch.
    context.signedIn ? ensure<ProjectRow[]>(context.queryClient, projectsQuery()) : undefined,
  pendingComponent: ProjectsSkeleton,
  component: Projects,
})

function Projects() {
  const { data, isError, refetch } = useQuery(projectsQuery())
  useHeaderActions(
    <Link to="/settings" title="Settings" aria-label="Settings" className={iconButtonClass}>
      <Settings2 size={18} />
    </Link>,
    [],
  )

  if (!data) {
    if (!isError) return <ProjectsSkeleton />
    return (
      <Container>
        <InlineError message="Could not load your projects." onRetry={() => refetch()} />
      </Container>
    )
  }

  // A project with a pending question is the only thing on this page that has
  // to be acted on, so it goes first, under its own heading.
  const waiting = data.filter((p) => p.pending > 0)
  const rest = data.filter((p) => p.pending === 0)

  if (data.length === 0) return <Container>{<EmptyState />}</Container>

  return (
    <Container>
      {waiting.length > 0 && (
        <Section title="Needs you" count={waiting.reduce((n, p) => n + p.pending, 0)}>
          {waiting.map((p) => (
            <ProjectLine key={p.project || '__none__'} p={p} />
          ))}
        </Section>
      )}
      <Section title="Projects">
        {rest.map((p) => (
          <ProjectLine key={p.project || '__none__'} p={p} />
        ))}
        {rest.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-muted">Everything else is up to date.</p>
        ) : null}
      </Section>
    </Container>
  )
}

function ProjectLine({ p }: { p: ProjectRow }) {
  return (
    <Link
      to="/project/$name"
      params={{ name: toParam(p.project) }}
      className="block text-text no-underline hover:bg-surface"
    >
      <Row time={<Time at={p.last_activity} />}>
        {/* Nudged down to sit on the title's optical centre, now that the row
            hangs its content from the top rather than centring it. */}
        <span className="mt-[7px] flex shrink-0">
          <ProjectDot project={p.project} />
        </span>
        <RowBody
          title={
            <span className="flex items-baseline gap-2">
              <span className="truncate">{projectLabel(p.project)}</span>
              {p.pending > 0 ? (
                <span
                  className={`shrink-0 text-[13px] font-semibold ${STATE_TEXT.pending}`}
                >
                  {p.pending} pending
                </span>
              ) : null}
              {p.unread > 0 ? (
                <span className="shrink-0 text-[13px] text-muted">{p.unread} unread</span>
              ) : null}
            </span>
          }
          detail={p.models.length > 0 ? p.models.join(', ') : null}
          bold={p.unread > 0}
        />
      </Row>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="px-4 py-12 text-center text-muted">
      <p className="mb-1">No projects yet.</p>
      <p className="text-[15px]">
        An agent's first update with a <code>project</code> starts one. The connection snippet is
        in <Link to="/settings">Settings</Link>.
      </p>
    </div>
  )
}
