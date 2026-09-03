// A group of rows under a heading. The heading is the only structure a list
// page has; there are no cards and no boxes around it.

// Settings groups its own rows differently - the rule goes under the heading,
// not around the rows - so the two cannot share a component. They share this
// instead, which is the part that has to stay identical.
//
// The heading is --color-text, not --color-muted: it is the name of what
// follows, not an aside about it. The rule under it is --color-edge (3.9:1),
// not the --color-line hairline, for the same reason - a boundary the reader
// is meant to see is not a hairline.
export const sectionHeadingClass = 'text-[14px] font-semibold text-text'

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
    <section className={`mb-8 ${className}`}>
      <h2 className={`mb-1.5 px-4 ${sectionHeadingClass}`}>
        {title}
        {count != null ? (
          <>
            {/* The gap is a margin, which the accessible name cannot see: without
                this the heading reads as one word, "Needs you3". The space is
                out of flow, so it separates the two in the name and adds
                nothing to the layout. */}
            <span className="sr-only"> </span>
            <span className="ml-2 text-faint">{count}</span>
          </>
        ) : null}
      </h2>
      <div className="border-t border-edge">{children}</div>
    </section>
  )
}
