// Four button roles and nothing else. Primary is the one accent colour in the
// app; secondary is an outline; danger is an outline that has gone red; answer
// is an outline in the colour that tells one option on a question from its
// siblings. Every one is at least 44px tall, so it stays a comfortable touch
// target.

type Variant = 'primary' | 'secondary' | 'danger' | 'answer'

const VARIANT: Record<Variant, string> = {
  // Dark label on the accent: 6.9:1. A light label on it would be 2.2:1.
  primary: 'bg-kind-question text-bg font-semibold hover:opacity-90',
  secondary: 'border border-edge text-text hover:bg-surface',
  danger: 'border border-kind-error text-kind-error hover:bg-surface',
  // Both values come from answerStyles in src/lib/answers.ts. The label is the
  // outline colour when that can be read on the page, and the page's own text
  // colour when an agent chose one that cannot. An outline and not a fill: the
  // secondary weight, in colour, so a list of these does not outshout the rows
  // it sits on. Hover tints the inside with the same colour. The option that
  // stands as the answer is filled with it, so the choice reads off the row.
  answer:
    'border border-[color:var(--answer-color)] text-[color:var(--answer-fg)] hover:bg-[color-mix(in_srgb,var(--answer-color)_15%,transparent)] aria-pressed:bg-[var(--answer-color)] aria-pressed:text-bg',
}

const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-ui px-4 text-[16px] leading-none disabled:cursor-not-allowed disabled:opacity-50'

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${BASE} ${VARIANT[variant]} ${className}`} {...rest} />
}

// Same shape as Button, for the places where the control is really a link.
export const buttonClass = (variant: Variant = 'secondary', className = '') =>
  `${BASE} ${VARIANT[variant]} ${className}`

// A header action: an icon on its own, with the same 44px touch target.
export function IconButton({
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex size-11 items-center justify-center rounded-ui text-muted hover:bg-surface hover:text-text ${className}`}
      {...rest}
    />
  )
}

export const iconButtonClass =
  'inline-flex size-11 items-center justify-center rounded-ui text-muted hover:bg-surface hover:text-text'
