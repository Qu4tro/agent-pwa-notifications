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
        {count != null ? <span className="ml-1.5 text-faint">{count}</span> : null}
      </h2>
      <div className="border-t border-line">{children}</div>
    </section>
  )
}
