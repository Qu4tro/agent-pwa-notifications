import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Container } from '../lib/shell'
import { ensure, eventQuery } from '../lib/queries'
import { toParam } from '../lib/project'
import type { EventItem } from '../lib/api'

// Push notifications deep-link here (/event/:id). The event is resolved to its
// thread and redirected before anything renders, so a tap lands inside the
// task conversation with the app layout already up.
export const Route = createFileRoute('/_app/event/$id')({
  ssr: false,
  // The redirect runs in `beforeLoad`, not in the loader: on the initial load
  // of a client-only route a loader redirect leaves the document empty, and a
  // notification tap is always an initial load.
  beforeLoad: async ({ context, params }) => {
    if (!context.signedIn) return // the layout guard is already sending this one to /login
    const event = await ensure<EventItem | null>(context.queryClient, eventQuery(params.id))
    if (!event) return
    const key = event.task_id && event.task_id.trim() ? event.task_id : event.id
    throw redirect({
      to: '/project/$name/task/$key',
      params: { name: toParam(event.project ?? ''), key },
      replace: true,
    })
  },
  component: EventGone,
})

function EventGone() {
  return (
    <Container>
      <p style={{ color: 'var(--muted)', padding: '2rem 0' }}>This message no longer exists.</p>
      <Link to="/">← Back to projects</Link>
    </Container>
  )
}
