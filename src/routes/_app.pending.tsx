import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { TaskSummary } from '../lib/api'
import { BackLink, Container, useHeaderBack } from '../lib/shell'
import { ensure, pendingQuery, queryKeys } from '../lib/queries'
import { PendingSkeleton } from '../lib/skeleton'
import { PendingLine } from '../lib/task-line'
import { InlineError } from '../lib/ui'

// Note 6: one page for everything waiting on the human, whatever project it is
// in. The header's bell links here and carries the count.
//
// The rows are the same rows as the project page - micro-answers inline, and
// the row on its own for anything larger - and they leave the same way: the
// optimistic write drops a row the moment its button is tapped, and the poll
// brings new ones in. Nothing is dismissed by hand.
export const Route = createFileRoute('/_app/pending')({
  ssr: false,
  loader: ({ context }) =>
    context.signedIn ? ensure<TaskSummary[]>(context.queryClient, pendingQuery()) : undefined,
  pendingComponent: PendingSkeleton,
  component: PendingPage,
})

function PendingPage() {
  const { data, isError, refetch } = useQuery(pendingQuery())
  useHeaderBack(<BackLink to="/" label="Projects" />, [])

  if (!data) {
    if (!isError) return <PendingSkeleton />
    return (
      <Container>
        <InlineError message="Could not load what is waiting." onRetry={() => refetch()} />
      </Container>
    )
  }

  return (
    <Container>
      <h1 className="mb-4 px-4 text-[22px] font-semibold">Needs you</h1>
      {data.length === 0 ? (
        <p className="px-4 py-12 text-center text-muted">You&apos;re all caught up.</p>
      ) : (
        <div className="border-t border-edge">
          {data.map((t) => (
            <PendingLine
              key={`${t.project}/${t.key}`}
              t={t}
              queryKey={queryKeys.pending()}
              from="pending"
            />
          ))}
        </div>
      )}
    </Container>
  )
}
