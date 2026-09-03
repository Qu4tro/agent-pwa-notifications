import { KIND_BG, KIND_LABEL, KIND_TEXT } from '../project'
import { Time } from './time'

// One line in a list. Everything on a list page is made of these: a time
// gutter, a 3px rail, 12px by 16px of padding, a hairline under it, one line of
// content and what happened under it. Nothing here is a card.
//
// The gutter is 56px wide and holds the row's own time, top-aligned with the
// title. A thread page's messages stand their times in a gutter of the same
// width, so a row and the message it opens into line up down the same column.

export function Row({
  children,
  time,
  className = '',
  divider = true,
}: {
  children: React.ReactNode
  // What the gutter holds. Rows that have no time of their own leave it empty
  // and keep the column, so nothing shifts left.
  time?: React.ReactNode
  className?: string
  // Off when something sits under the row inside the same entry, such as the
  // answer buttons of a pending micro-question.
  divider?: boolean
}) {
  return (
    <div className={`flex ${divider ? 'border-b border-b-line' : ''} ${className}`}>
      <div className="w-14 shrink-0 py-3 pr-1.5 pl-4 text-right text-[13px] leading-[21px] whitespace-nowrap text-faint">
        {time}
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2.5 border-l-[3px] border-l-transparent py-3 pr-4 pl-2.5">
        {children}
      </div>
    </div>
  )
}

// One event on a task row's timeline. `at` is null on the newest event, whose
// time the row's gutter is already showing.
export interface TimelineItem {
  id: string
  kind: string
  title: string
  at: number | null
  unread: boolean
}

// The middle of a row: title on top, and under it either one muted line of
// detail or the thread's timeline. Every line truncates, so a long agent title
// can never push the row wider or taller than its own line.
export function RowBody({
  title,
  detail,
  timeline,
  bold,
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  // What happened on this thread, newest first, with however many events are
  // not shown counted at the bottom.
  timeline?: { items: TimelineItem[]; earlier: number }
  bold?: boolean
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className={`truncate leading-tight ${bold ? 'font-semibold' : ''}`}>{title}</div>
      {detail != null ? (
        <div className="truncate text-[15px] leading-[1.35] text-muted">{detail}</div>
      ) : null}
      {timeline ? <Timeline {...timeline} /> : null}
    </div>
  )
}

// A sequence, drawn as one: a hairline down the left with a dot on it per
// event, in that event's kind colour, and the event's own time at the right.
// Three muted subtitles say the same words and read as three subtitles.
function Timeline({ items, earlier }: { items: TimelineItem[]; earlier: number }) {
  if (items.length === 0) return null
  return (
    <>
      <ol className="relative mt-1 flex flex-col gap-1">
        {/* First dot's centre to last dot's centre, and no further. */}
        <span aria-hidden className="absolute top-[10px] bottom-[10px] left-[2.5px] w-px bg-line" />
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-[7px] size-1.5 shrink-0 rounded-full ${KIND_BG[it.kind] ?? 'bg-muted'}`}
            />
            {/* Unread keeps full-weight text, the same signal the row uses. */}
            <span
              className={`min-w-0 flex-1 truncate text-[15px] leading-[1.35] ${
                it.unread ? 'text-text' : 'text-muted'
              }`}
            >
              <span className={`text-[13px] font-semibold ${KIND_TEXT[it.kind] ?? 'text-muted'}`}>
                {KIND_LABEL[it.kind] ?? 'Event'}
              </span>{' '}
              {it.title}
            </span>
            {/* The time never truncates; the title gives way to it first. */}
            {it.at != null ? (
              <Time at={it.at} className="shrink-0 pt-[3px] text-[13px] text-faint" />
            ) : null}
          </li>
        ))}
      </ol>
      {earlier > 0 ? (
        <div className="mt-1 pl-[14px] text-[15px] leading-[1.35] text-faint">
          +{earlier} earlier
        </div>
      ) : null}
    </>
  )
}
