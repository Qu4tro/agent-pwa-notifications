// A group of rows under a small uppercase heading. The heading is the only
// structure a list page has; there are no cards and no boxes around it.

export function Section({
  title,
  count,
  children,
  className = '',
}: {
  title: string
  count?: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`mb-6 ${className}`}>
      <h2 className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
        {title}
        {count != null ? (
          <>
            {/* The gap is a margin, which the accessible name cannot see: without
                this the heading reads as one word, "Needs you3". The space is
                out of flow, so it separates the two in the name and adds
                nothing to the layout. */}
            <span className="sr-only"> </span>
            <span className="ml-1.5 text-faint">{count}</span>
          </>
        ) : null}
      </h2>
      <div className="border-t border-line">{children}</div>
    </section>
  )
}
