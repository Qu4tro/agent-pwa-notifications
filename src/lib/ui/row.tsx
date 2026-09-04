import { KIND_BG, KIND_LABEL, KIND_TEXT, STATE_TEXT } from '../project'

// One line in a list. Everything on a list page is made of these: a time
// gutter, a 3px rail, 12px by 16px of padding, a hairline under it, one line of
// content and what happened under it. Nothing here is a card.
//
// The gutter is 56px wide and holds the row's own time, top-aligned with the
// title. A thread page's messages stand their times in a gutter of the same
// width, so a row and the message it opens into line up down the same column.
//
// The whole row is one wrapping flex line: gutter, body, answers. The answers
// are a column of one fixed width (18rem), so every row's buttons share one
// left edge and every body truncates at the same point down the list; a group
// that sizes to its own labels would leave a ragged edge that the eye has
// nowhere to rest on. The body takes every scrap of slack (grow 9999 against
// the answers' 1), and the buttons split the column between them in equal
// shares. When the column does not fit beside the body, it wraps to a line of
// its own and its grow makes it span that line, which is what "full width if
// they do not fit" means here. Nothing measures anything in JavaScript.
//
// The column grows for a group of labels wider than it (min-w-fit), rather
// than stacking them inside it; and fit-content caps that at the row, so a
// wide group on a narrow screen wraps within the row instead of overflowing.

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
        <div className="flex min-w-fit grow basis-[18rem] flex-wrap items-start gap-2 pt-3 pr-4 pb-3 pl-4">
          {answers}
        </div>
      ) : null}
    </div>
  )
}

export interface TimelineItem {
  id: string
  kind: string
  title: string
  unread: boolean
  // What was decided, on a question that has been settled. `answered` carries
  // the answer itself; `expired` carries the word. A pending question says it
  // needs one, so the timeline reads as open.
  answer?: { status: 'answered' | 'expired' | 'pending'; text: string } | null
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
// event, in that event's kind colour. Three muted subtitles say the same words
// and read as three subtitles.
//
// The geometry is in whole pixels on purpose. Every line is 20px tall, so each
// dot and both ends of the rail land on a pixel edge; a fractional line height
// puts the lower dots on half pixels, and a browser that does not snap blurs
// them. The dot is 7px, an odd size, so a 1px rail has a pixel column to sit
// on dead centre; under a 6px dot it is half a pixel off whichever way it
// goes. And the dot is positioned, so it paints over the rail: an absolutely
// positioned rail paints after in-flow content, and would otherwise draw a
// line straight through every dot.
function Timeline({ items, earlier }: { items: TimelineItem[]; earlier: number }) {
  if (items.length === 0) return null
  return (
    <>
      <ol className="relative mt-1 flex flex-col gap-1">
        {/* From under the first dot to under the last, and no further. */}
        <span aria-hidden className="absolute top-[10px] bottom-[10px] left-[3px] w-px bg-line" />
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-x-2 gap-y-0 leading-5">
            <span
              aria-hidden
              className={`relative mt-[7px] size-[7px] shrink-0 rounded-full ${KIND_BG[it.kind] ?? 'bg-muted'}`}
            />
            <span
              className={`shrink-0 text-[13px] font-semibold ${KIND_TEXT[it.kind] ?? 'text-muted'}`}
            >
              {KIND_LABEL[it.kind] ?? 'Event'}
            </span>
            {/* Unread keeps full-weight text, the same signal the row uses.
                The title does not grow: what became of it follows immediately,
                and the slack is left at the end of the line. */}
            <span
              className={`min-w-0 truncate text-[15px] ${
                it.unread ? 'text-text' : 'text-muted'
              }`}
            >
              {it.title}
            </span>
            {/* What became of the question, set against the words it answers
                rather than out at the row's right edge. The eye pairs by
                proximity, and there is none across a row: an answer in a column
                of its own reads as a second, unrelated thing, and the reader
                has to cross the line to find which question it settled.

                The arrow is the cue that is not colour, so the join holds for a
                reader who does not see the green (WCAG 1.4.1), and it is ASCII
                like every other string here. The answer takes the title's
                weight - one clause in one voice - and keeps the state colour,
                which is the only thing colour carries.

                The title gives way first, but only as far as half the line: an
                answer that is a whole sentence would otherwise leave a row that
                says what was decided and never what was asked. */}
            {it.answer ? (
              <>
                <span aria-hidden className="shrink-0 text-[15px] text-faint">
                  -&gt;
                </span>
                {it.answer.status === 'answered' ? (
                  <span
                    className={`max-w-[55%] shrink-0 truncate text-[15px] ${STATE_TEXT.answered}`}
                  >
                    <span className="sr-only">answered </span>
                    {it.answer.text}
                  </span>
                ) : it.answer.status === 'pending' ? (
                  <span className={`shrink-0 text-[15px] italic ${STATE_TEXT.pending}`}>
                    {it.answer.text}
                  </span>
                ) : (
                  <span className={`shrink-0 text-[15px] ${STATE_TEXT.expired}`}>
                    expired
                  </span>
                )}
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {earlier > 0 ? (
        <div className="mt-1 pl-[15px] text-[15px] leading-5 text-faint">
          +{earlier} earlier
        </div>
      ) : null}
    </>
  )
}
