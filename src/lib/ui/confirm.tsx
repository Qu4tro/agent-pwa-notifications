// The one shape a destructive confirmation takes. Three places ask the same
// kind of question - clear this project, clear the whole inbox, rotate the
// agent key - and a panel that looks different each time is one the eye has to
// stop and read again.
//
// It is a surface with an edge, not a rule on the page background: what has
// just appeared has to read as a distinct thing, and --color-line is a 1.3:1
// hairline that carries no information by design. The red rail on the left
// says which way this one goes without spending a colour on the whole box.
export function ConfirmPanel({
  children,
  actions,
  className = '',
}: {
  // The sentence that says what is about to happen.
  children: React.ReactNode
  // The buttons that do it, and the one that does not.
  actions: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`ui-panel rounded-ui border border-l-[3px] border-edge border-l-kind-error bg-surface px-4 py-3 ${className}`}
    >
      <div className="mb-3 text-text">{children}</div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}
