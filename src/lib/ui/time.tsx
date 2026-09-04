import { timeAgo, timeAgoShort } from '../api'

// When something happened, in the two forms the app has room for, and with the
// exact moment on hover in both. Nothing in the interface used to carry the
// full date: "4d" is enough to scan a list with and never enough to know which
// Tuesday, and a bare span has nothing for a pointer to rest on.
//
// <time> with a machine-readable dateTime, so the value is not only paint.
export function Time({
  at,
  long = false,
  className = '',
}: {
  at: number
  long?: boolean
  className?: string
}) {
  const d = new Date(at)
  return (
    <time dateTime={d.toISOString()} title={fullDate(d)} className={className}>
      {long ? timeAgo(at) : timeAgoShort(at)}
    </time>
  )
}

// The reader's own locale and time zone, written out in full. The events are
// stamped in UTC; nobody reads their own day in UTC.
function fullDate(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}
