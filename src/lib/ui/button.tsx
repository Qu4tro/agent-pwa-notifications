// Four button roles and nothing else. Primary is the one accent colour in the
// app; secondary is an outline; danger is an outline that has gone red; answer
// is a soft fill, one option on a question. Every one is at least 44px tall,
// so it stays a comfortable touch target.

type Variant = 'primary' | 'secondary' | 'danger' | 'answer'

const VARIANT: Record<Variant, string> = {
  // Dark label on the accent: 6.9:1. A light label on it would be 2.2:1.
  primary: 'bg-kind-question text-bg font-semibold hover:opacity-90',
  secondary: 'border border-edge text-text hover:bg-surface',
  danger: 'border border-kind-error text-kind-error hover:bg-surface',
  // A soft fill and not an outline, in no colour of its own: the neutral fill
  // a step above the surface, the page's text on it, and a step lighter again
  // under the pointer - a row hovers to the surface, so the fill has to sit
  // above that to stay a control on a row under the pointer. The custom
  // properties come from answerStyles in src/lib/answers.ts, and only for an
  // option the agent coloured; for the rest the fallbacks stand. The option
  // that stands as the answer is filled solid - with its colour, or with the
  // page text where it has none - and the label goes to the page colour, so
  // the choice reads off the row.
  answer:
    'bg-[var(--answer-fill,var(--color-raised))] font-medium text-text hover:bg-[var(--answer-fill-hover,var(--color-raised-hover))] aria-pressed:bg-[var(--answer-color,var(--color-text))] aria-pressed:text-bg',
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
