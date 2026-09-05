import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ProjectRow } from '../lib/api'
import { Container } from '../lib/shell'
import { ensure, projectsQuery } from '../lib/queries'
import { ProjectsSkeleton } from '../lib/skeleton'
import { projectLabel, toParam, STATE_TEXT } from '../lib/project'
import {
  InlineError,
  ProjectDot,
  Row,
  RowBody,
  Section,
  Time,
  badgeClass,
  rowLinkClass,
} from '../lib/ui'

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

// A project row says two things beside its name, and they are not the same
// thing. "N pending" is what needs an answer, in the question colour, on the
// title line where the eye lands. New is a count in a neutral pill at the far
// edge: it is the same pill as the bell in the header, minus the colour, so it
// reads as a count and never as louder than the pending label beside it. It
// used to be the words "N unread" in muted 13px text, which is the style of
// the model list under it and read as part of that.
//
// The pill counts what the pending label does not. A pending question stays
// unread until it is answered, so a row that said "2 pending  2 unread" was
// counting the same two events twice.
function ProjectLine({ p }: { p: ProjectRow }) {
  const fresh = Math.max(0, p.unread - p.pending)
  return (
    <Row time={<Time at={p.last_activity} />}>
      <Link to="/project/$name" params={{ name: toParam(p.project) }} className={rowLinkClass}>
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
            </span>
          }
          detail={p.models.length > 0 ? p.models.join(', ') : null}
          bold={p.unread > 0}
        />
        {fresh > 0 ? (
          // 2px down puts the 1.1rem pill on the centre of the title's 21px
          // line, the same way the dot is nudged on the left.
          <span className={`${badgeClass} mt-0.5 shrink-0 bg-line text-text`}>
            {fresh}
            <span className="sr-only"> unread</span>
          </span>
        ) : null}
      </Link>
    </Row>
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
