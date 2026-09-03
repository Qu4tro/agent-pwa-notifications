// One line in a list. Everything on a list page is made of these: 12px by 16px
// of padding, a hairline under it, one line of content and at most one line of
// detail. Nothing here is a card.

export function Row({
  children,
  className = '',
  divider = true,
}: {
  children: React.ReactNode
  className?: string
  // Off when something sits under the row inside the same entry, such as the
  // answer buttons of a pending micro-question.
  divider?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2.5 border-l-[3px] border-l-transparent px-4 py-3 ${
        divider ? 'border-b border-b-line' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

// The middle of a row: title on top, muted detail under it. A list of nodes
// becomes a line each, which is how a task row shows what happened on its
// thread rather than only how many things did. Every line truncates, so a long
// agent title can never push the row wider or taller than its own line.
export function RowBody({
  title,
  detail,
  bold,
}: {
  title: React.ReactNode
  detail?: React.ReactNode | React.ReactNode[]
  bold?: boolean
}) {
  const lines = detail == null ? [] : Array.isArray(detail) ? detail : [detail]
  return (
    <div className="min-w-0 flex-1">
      <div className={`truncate leading-tight ${bold ? 'font-semibold' : ''}`}>{title}</div>
      {lines.map((line, i) => (
        <div key={i} className="truncate text-[15px] leading-[1.35] text-muted">
          {line}
        </div>
      ))}
    </div>
  )
}

// Right-aligned, never wraps, never grows: the time, a count, a chevron.
export function RowMeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-[13px] whitespace-nowrap text-faint">
      {children}
    </div>
  )
}
