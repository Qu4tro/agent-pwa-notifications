// Answer buttons: the order a question's options stand in, and the colour
// each one wears - which is none, unless the agent asked for one.
//
// An option is a soft neutral fill (--color-raised) with the page's own text
// on it. Colour on an answer says one thing: the agent chose it, on purpose,
// for that option. It used to say more - every option had a colour of its
// own, and a plain "No" came out red - and that was an exception to "colour
// carries meaning and nothing else" that carried none. A row of coloured
// pills said "these are different", which the labels already say, and it
// painted a denial as an error, which a denial is not.
//
// The eight names an agent can send are kept, so a question written against
// them still resolves. A named colour is worn as a tint of the fill, under
// the same page text as every other option: the eight are a step too dark to
// be read as a label on a fill of their own hue, and a label the agent's
// colour can make unreadable is not a label.

export const ANSWER_PALETTE = {
  blue: '#3b82f6',
  violet: '#a35bff',
  mint: '#16a34a',
  rose: '#f43f5e',
  amber: '#f59e0b',
  cyan: '#06b6d4',
  pink: '#ee46b0',
  lime: '#84cc16',
} as const

export type AnswerColorName = keyof typeof ANSWER_PALETTE

const HEX = /^#[0-9a-f]{6}$/i

// Two short lists of what an answer can be, for where it stands: an
// affirmative first, whatever else there is next, a denial last. A reader who
// has answered three of these rows knows where the yes is on the fourth
// before reading it, which is what makes a list of them quick to answer.
//
// Whole labels, not substrings, with case and trailing punctuation ignored. A
// substring rule would place "Nope, not now" from "no" and "Yes, but hold"
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

// Where a label goes by what it says: the front, the middle, or the end.
function rank(label: string): 0 | 1 | 2 {
  const word = normalise(label)
  if (AFFIRM.has(word)) return 0
  if (DENY.has(word)) return 2
  return 1
}

// The order a question's options are shown in, as indices into `labels`:
// affirmatives first, denials last, and everything else between them as the
// agent wrote it. Stable within each group, so two affirmatives keep the
// agent's order and a question with neither keeps it entirely.
//
// Indices rather than labels, so the caller can carry whatever it holds
// parallel to the labels - the agent's colours, the answer documents -
// through the same permutation.
export function answerOrder(labels: string[]): number[] {
  return labels
    .map((label, i) => ({ i, rank: rank(label) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.i)
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

// `amount` of one colour over the other, channel by channel in sRGB - what
// color-mix(in srgb) would paint, worked out here so the result is a hex the
// label can be checked against.
function mix(color: string, over: string, amount: number): string {
  const at = (hex: string, i: number) => parseInt(hex.slice(1 + i, 3 + i), 16)
  const channel = (i: number) => Math.round(at(color, i) * amount + at(over, i) * (1 - amount))
  return '#' + [0, 2, 4].map((i) => channel(i).toString(16).padStart(2, '0')).join('')
}

// The neutral fills, as declared in src/styles.css, and how much of a colour
// goes over them. Enough that the tint is seen beside a neutral option, and
// the page text still clears 5:1 on the brightest of the eight, under the
// pointer too.
const RAISED = '#232833' // --color-raised
const RAISED_HOVER = '#363c4b' // --color-raised-hover
const TINT = 0.3

// The two fills a coloured option wears: its colour over the neutral fill,
// and over the neutral fill under the pointer.
export function answerFills(color: string): { fill: string; hover: string } {
  return { fill: mix(color, RAISED, TINT), hover: mix(color, RAISED_HOVER, TINT) }
}

// What the answer buttons on one question wear, one style per option. Nothing
// for an option the agent did not colour: the button's own fallbacks are the
// neutral fill and its hover. For one it did, three custom properties - the
// colour, which the option that stands is filled with, and its two tints -
// rather than a class, because the value is per option and Tailwind can only
// see class names it can read in the source.
export function answerStyles(
  labels: string[],
  colors?: (string | undefined)[],
): React.CSSProperties[] {
  return labels.map((_, i) => {
    const color = overrideColor(colors?.[i])
    if (!color) return {}
    const { fill, hover } = answerFills(color)
    return {
      '--answer-color': color,
      '--answer-fill': fill,
      '--answer-fill-hover': hover,
    } as React.CSSProperties
  })
}
