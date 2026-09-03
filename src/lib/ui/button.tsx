// Four button roles and nothing else. Primary is the one accent colour in the
// app; secondary is an outline; danger is an outline that has gone red; answer
// is one option on a question, wearing the colour that tells it from its
// siblings. Every one is at least 44px tall, so it stays a comfortable touch
// target.

type Variant = 'primary' | 'secondary' | 'danger' | 'answer'

const VARIANT: Record<Variant, string> = {
  // Dark label on the accent: 6.9:1. A light label on it would be 2.2:1.
  primary: 'bg-kind-question text-bg font-semibold hover:opacity-90',
  secondary: 'border border-edge text-text hover:bg-surface',
  danger: 'border border-kind-error text-kind-error hover:bg-surface',
  // Both values come from answerStyle in src/lib/answers.ts, which picks the
  // label colour by luminance so a dark fill never gets a dark label.
  answer: 'bg-[var(--answer-bg)] text-[var(--answer-fg)] font-semibold hover:opacity-90',
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
