// One colour per answer on a question, so two choices side by side are told
// apart before they are read.
//
// This is the second deliberate exception to "colour carries meaning and
// nothing else" in src/styles.css; the first is .hl. What the colour says here
// is "these are different choices" and nothing more. It is a register of its
// own - eight pale tints, well away from the four saturated kind colours - so
// an answer never reads as an event kind.

export const ANSWER_PALETTE = {
  blue: '#bcd4ff',
  violet: '#d6cbfd',
  mint: '#a9edd0',
  rose: '#fcc7c7',
  amber: '#fbe2a8',
  cyan: '#aeeaf6',
  pink: '#fbc6e2',
  lime: '#d9f2a4',
} as const

export type AnswerColorName = keyof typeof ANSWER_PALETTE

// The order the palette is walked in. Option i takes entry i % 8: by index,
// not by hashing the label. Three options against eight colours collide on
// about a third of questions under a hash, and siblings differing is the whole
// point.
const ORDER = Object.keys(ANSWER_PALETTE) as AnswerColorName[]

const HEX = /^#[0-9a-f]{6}$/i

// What an agent is allowed to send: one of the eight names, or six hex digits.
// Nothing else resolves, so nothing a style attribute could act on - `url(`,
// an expression, a second declaration - can ever reach the DOM through here.
export function overrideColor(value: string | undefined): string | null {
  if (!value) return null
  const name = value.toLowerCase() as AnswerColorName
  if (name in ANSWER_PALETTE) return ANSWER_PALETTE[name]
  return HEX.test(value) ? value.toLowerCase() : null
}

// An agent-set colour where there is one, and the palette where there is not.
export function resolveAnswerColor(value: string | undefined, index: number): string {
  return overrideColor(value) ?? ANSWER_PALETTE[ORDER[index % ORDER.length]]
}

// WCAG relative luminance.
function luminance(hex: string): number {
  const h = hex.slice(1)
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// Dark label or light one, whichever reads better on the fill. The eight names
// are all pale enough that this always answers "dark", but an agent that sends
// #1e3a8a would otherwise get dark text on navy.
const BG_LUMINANCE = luminance('#0f1115') // --color-bg
const TEXT_LUMINANCE = luminance('#e6e8ee') // --color-text

export function answerTextColor(fill: string): string {
  const l = luminance(fill)
  return contrast(l, BG_LUMINANCE) >= contrast(l, TEXT_LUMINANCE)
    ? 'var(--color-bg)'
    : 'var(--color-text)'
}

// What the answer buttons on one question wear. Two custom properties rather
// than a class, because the value is per option and Tailwind can only see
// class names it can read in the source.
//
// Resolved for the whole question at once, not one option at a time, so the
// palette can walk past anything an agent has already claimed. Colouring the
// first of three options mint and leaving the rest alone would otherwise hand
// the third one mint as well, which is the one thing this is here to prevent.
export function answerStyles(count: number, colors?: (string | undefined)[]): React.CSSProperties[] {
  const overrides = Array.from({ length: count }, (_, i) => overrideColor(colors?.[i]))
  const taken = new Set(overrides.filter((fill): fill is string => fill != null))

  let cursor = 0
  const nextFree = (): string => {
    for (let n = 0; n < ORDER.length; n++) {
      const fill = ANSWER_PALETTE[ORDER[(cursor + n) % ORDER.length]]
      if (!taken.has(fill)) {
        cursor = (cursor + n + 1) % ORDER.length
        return fill
      }
    }
    // Every colour is spoken for: more than eight options, or an agent that
    // named all eight. Walk the palette in order and let them repeat.
    const fill = ANSWER_PALETTE[ORDER[cursor]]
    cursor = (cursor + 1) % ORDER.length
    return fill
  }

  return overrides.map((override) => {
    const fill = override ?? nextFree()
    return { '--answer-bg': fill, '--answer-fg': answerTextColor(fill) } as React.CSSProperties
  })
}
