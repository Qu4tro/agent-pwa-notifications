import { KIND_BG, KIND_LABEL, KIND_TEXT, STATE_TEXT } from '../project'
import { Time } from './time'

// One line in a list. Everything on a list page is made of these: a time
// gutter, a 3px rail, 12px by 16px of padding, a hairline under it, one line of
// content and what happened under it. Nothing here is a card.
//
// The gutter is 56px wide and holds the row's own time, top-aligned with the
// title. A thread page's messages stand their times in a gutter of the same
// width, so a row and the message it opens into line up down the same column.
//
// The whole row is one wrapping flex line: gutter, body, answers. The body
// takes every scrap of slack (grow 9999 against the answers' 1), so when the
// answers fit they sit at the right of the row at their own width. When they
// do not, they wrap to a line of their own and their grow makes them span it,
// which is what "full width if they do not fit" means here. Nothing measures
// anything in JavaScript.

// The row's body is a link to whatever the row is about. The padding is on the
// link, not around it, so the whole body is the target.
export const rowLinkClass =
  'flex min-w-0 flex-1 items-start gap-2.5 py-3 pr-4 pl-2.5 text-text no-underline'

export function Row({
  children,
  time,
  answers,
  className = '',
}: {
  children: React.ReactNode
  // What the gutter holds. Rows that have no time of their own leave it empty
  // and keep the column, so nothing shifts left.
  time?: React.ReactNode
  // Controls that belong to this row and cannot live inside its link, because
  // a button cannot sit inside one.
  answers?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-start border-b border-b-line hover:bg-surface ${className}`}>
      <div className="w-14 shrink-0 py-3 pr-1.5 pl-4 text-right text-[13px] leading-[21px] whitespace-nowrap text-faint">
        {time}
      </div>
      <div className="flex min-w-0 grow-[9999] basis-[16rem] border-l-[3px] border-l-transparent">
        {children}
      </div>
      {answers ? (
        <div className="flex grow basis-auto flex-wrap items-start gap-2 pt-3 pr-4 pb-3 pl-4">
          {answers}
        </div>
      ) : null}
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
  // What was decided, on a question that has been settled. `answered` carries
  // the answer itself; `expired` carries the word. A question still waiting
  // carries nothing, because its buttons are on the row.
  answer?: { status: 'answered' | 'expired'; text: string } | null
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
          <li key={it.id} className="flex items-start gap-x-1.5 gap-y-0">
            <span
              aria-hidden
              className={`mt-[7px] mr-0.5 size-1.5 shrink-0 rounded-full ${KIND_BG[it.kind] ?? 'bg-muted'}`}
            />
            <span
              className={`shrink-0 text-[13px] font-semibold ${KIND_TEXT[it.kind] ?? 'text-muted'}`}
            >
              {KIND_LABEL[it.kind] ?? 'Event'}
            </span>
            {/* Unread keeps full-weight text, the same signal the row uses. */}
            <span
              className={`min-w-0 flex-1 truncate text-[15px] leading-[1.35] ${
                it.unread ? 'text-text' : 'text-muted'
              }`}
            >
              {it.title}
            </span>
            {/* What was decided, and then when. The title gives way to both
                before either gives way - but only as far as half the line: an
                answer that is a whole sentence would otherwise leave a row
                that says what was decided and never what was asked. */}
            {it.answer ? (
              it.answer.status === 'answered' ? (
                <span
                  className={`max-w-[55%] shrink-0 truncate text-[15px] leading-[1.35] font-semibold ${STATE_TEXT.answered}`}
                >
                  <span className="sr-only">answered </span>
                  {it.answer.text}
                </span>
              ) : (
                <span className={`shrink-0 text-[15px] leading-[1.35] ${STATE_TEXT.expired}`}>
                  expired
                </span>
              )
            ) : null}
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
