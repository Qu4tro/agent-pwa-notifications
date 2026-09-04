// One colour per answer on a question, so two choices side by side are told
// apart before they are read.
//
// This is the second deliberate exception to "colour carries meaning and
// nothing else" in src/styles.css; the first is .hl. What the colour says here
// is "these are different choices" and nothing more. It is a register of its
// own - eight pale tints, well away from the four saturated kind colours - so
// an answer never reads as an event kind.
//
// The colour is worn as an outline and a label, never as a fill. The rows the
// buttons sit on are muted text on a dark page, and a pale block on that page
// is the loudest thing on it: a list of them outweighs the titles they belong
// to. A pale line and pale text tell two choices apart just as well, at the
// weight of the row.

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

// The colours handed out by position, in the order they are walked. Mint and
// rose are not among them: they are what an affirmative and a denial wear
// (AFFIRM and DENY, below), and a reader who has learnt down four rows that
// green means yes must not find it on "A tenth" on the fifth. An agent can
// still name either outright, and is then saying so on purpose.
//
// Lime and pink come last. They are the nearest neighbours of mint and rose,
// and a question with two or three options should never reach them.
//
// By position, not by hashing the label: under a hash, siblings collide, and
// siblings differing is the whole point.
const WALK: AnswerColorName[] = ['blue', 'violet', 'amber', 'cyan', 'lime', 'pink']

const HEX = /^#[0-9a-f]{6}$/i

// Two short lists of what an answer can be, where the colour is not decoration
// but the answer itself. "Yes" and "No" in two arbitrary pastels make the eye
// stop and read; in green and red they do not have to. Everything else keeps
// the "these are different choices" register, which says nothing about which
// one is which.
//
// Green is the palette's mint and red its rose - pale, and in the answers'
// own register, so a deny option never reads as the error colour an event
// kind uses.
//
// Whole labels, not substrings, with case and trailing punctuation ignored. A
// substring rule would colour "Nope, not now" from "no" and "Yes, but hold"
// from "yes", which is the opposite of what either list is for. Multi-word
// entries are allowed, and are why the match is on the whole label.
export const AFFIRM = new Set([
  'yes', 'y', 'yep', 'yeah', 'yup', 'ok', 'okay', 'sure', 'correct', 'right',
  'true', 'confirm', 'confirmed', 'approve', 'approved', 'accept', 'accepted',
  'agree', 'i agree', 'allow', 'enable', 'go', 'go ahead', 'do it', 'proceed',
  'continue', 'looks good', 'lgtm', 'all good', 'sounds good', 'yes please',
])

export const DENY = new Set([
  'no', 'n', 'nope', 'nah', 'wrong', 'incorrect', 'false', 'deny', 'denied',
  'reject', 'rejected', 'decline', 'declined', 'disagree', 'cancel', 'stop',
  'abort', 'never', 'do not', "don't", 'not now', 'disable', 'block', 'skip it',
  'no thanks', 'leave it',
])

// Case, surrounding space and a trailing full stop or bang are noise: an agent
// writes "Yes." as readily as "yes".
function normalise(label: string): string {
  return label.toLowerCase().trim().replace(/[.!?,;:]+$/, '').replace(/\s+/g, ' ')
}

// The colour a label earns by what it says, or null when it says nothing about
// which choice it is.
export function wordColor(label: string): string | null {
  const word = normalise(label)
  if (AFFIRM.has(word)) return ANSWER_PALETTE.mint
  if (DENY.has(word)) return ANSWER_PALETTE.rose
  return null
}

// What an agent is allowed to send: one of the eight names, or six hex digits.
// Nothing else resolves, so nothing a style attribute could act on - `url(`,
// an expression, a second declaration - can ever reach the DOM through here.
export function overrideColor(value: string | undefined): string | null {
  if (!value) return null
  const name = value.toLowerCase() as AnswerColorName
  if (name in ANSWER_PALETTE) return ANSWER_PALETTE[name]
  return HEX.test(value) ? value.toLowerCase() : null
}

// An agent-set colour where there is one, and the walk where there is not.
export function resolveAnswerColor(value: string | undefined, index: number): string {
  return overrideColor(value) ?? ANSWER_PALETTE[WALK[index % WALK.length]]
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

// The label colour for an answer colour: the colour itself when it can be read
// on the page, and the page's own text colour when it cannot. The eight names
// all clear 10:1 against the background, so this only ever matters for a hex
// an agent chose - #1e3a8a is under 2:1 here and would be lost as a label. The
// outline keeps the colour either way, since the agent asked for it; the label
// is the part that has to be readable.
const BG_LUMINANCE = luminance('#0f1115') // --color-bg
const READABLE = 4.5 // WCAG AA for text at this size

export function answerTextColor(color: string): string {
  return contrast(luminance(color), BG_LUMINANCE) >= READABLE ? color : 'var(--color-text)'
}

// What the answer buttons on one question wear: the outline colour, and the
// label colour. Two custom properties rather than a class, because the value is
// per option and Tailwind can only see class names it can read in the source.
//
// Three rules, in order: what the agent asked for, what the label says it is,
// then the walk. Resolved for the whole question at once, not one option at a
// time, so the walk can step past anything the first two have claimed:
// colouring the first of three options blue by name and leaving the rest alone
// would otherwise hand the second one blue as well, which is the one thing
// this is here to prevent.
export function answerStyles(
  labels: string[],
  colors?: (string | undefined)[],
): React.CSSProperties[] {
  const fixed = labels.map((label, i) => overrideColor(colors?.[i]) ?? wordColor(label))
  const taken = new Set(fixed.filter((color): color is string => color != null))

  let cursor = 0
  const nextFree = (): string => {
    for (let n = 0; n < WALK.length; n++) {
      const color = ANSWER_PALETTE[WALK[(cursor + n) % WALK.length]]
      if (!taken.has(color)) {
        cursor = (cursor + n + 1) % WALK.length
        return color
      }
    }
    // Every colour is spoken for: more than six unnamed options, or an agent
    // that named all six. Walk them in order and let them repeat.
    const color = ANSWER_PALETTE[WALK[cursor]]
    cursor = (cursor + 1) % WALK.length
    return color
  }

  return fixed.map((known) => {
    const color = known ?? nextFree()
    return { '--answer-color': color, '--answer-fg': answerTextColor(color) } as React.CSSProperties
  })
}
