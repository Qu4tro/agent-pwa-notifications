import { describe, expect, it } from 'vitest'
import {
  ANSWER_PALETTE,
  answerStyles,
  answerTextColor,
  overrideColor,
  resolveAnswerColor,
  wordColor,
} from '../../src/lib/answers'

// WCAG relative luminance and contrast, worked out here rather than imported,
// so the test does not check the module against its own arithmetic.
function luminance(hex: string): number {
  const h = hex.slice(1)
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const names = Object.keys(ANSWER_PALETTE) as (keyof typeof ANSWER_PALETTE)[]

// The two colours the words own. The walk must never hand them out.
const SPOKEN_FOR = new Set<string>([ANSWER_PALETTE.mint, ANSWER_PALETTE.rose])

describe('the walk', () => {
  it('gives every option its own colour until the six run out', () => {
    const six = Array.from({ length: 6 }, (_, i) => resolveAnswerColor(undefined, i))
    expect(new Set(six).size).toBe(6)
  })

  it('wraps by index, so a seventh option starts again', () => {
    expect(resolveAnswerColor(undefined, 6)).toBe(resolveAnswerColor(undefined, 0))
    expect(resolveAnswerColor(undefined, 9)).toBe(resolveAnswerColor(undefined, 3))
  })

  it('never hands out mint or rose, which the words own', () => {
    for (let i = 0; i < 12; i++) {
      expect(SPOKEN_FOR.has(resolveAnswerColor(undefined, i)), `index ${i}`).toBe(false)
    }
  })

  it('reaches lime and pink last, since they neighbour mint and rose', () => {
    const first = [0, 1, 2, 3].map((i) => resolveAnswerColor(undefined, i))
    expect(first).not.toContain(ANSWER_PALETTE.lime)
    expect(first).not.toContain(ANSWER_PALETTE.pink)
  })
})

describe('the eight', () => {
  it('is readable as text on both surfaces a button sits on', () => {
    // The page, and the row under the pointer. The same ratio covers the
    // option that stands, which is the page colour on a fill of the colour.
    for (const [name, hex] of Object.entries(ANSWER_PALETTE)) {
      expect(contrast(hex, '#0f1115'), name).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex, '#161920'), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('is a register of its own, a step under the kind colour of its family', () => {
    // Five of the eight share a hue family with a colour the kind axis owns,
    // which the names make unavoidable. What keeps an answer from reading as
    // an event kind is that every one of the five is the darker of the pair.
    const family: [keyof typeof ANSWER_PALETTE, string][] = [
      ['blue', '#5b9bff'], // --color-kind-update
      ['violet', '#a78bfa'], // --color-kind-question
      ['mint', '#34d399'], // --color-kind-done
      ['rose', '#f87171'], // --color-kind-error
      ['amber', '#fbbf24'], // --color-warn
    ]
    for (const [name, kind] of family) {
      expect(luminance(ANSWER_PALETTE[name]), name).toBeLessThan(luminance(kind))
    }
  })

  it('gives every name a colour of its own', () => {
    expect(new Set(Object.values(ANSWER_PALETTE)).size).toBe(names.length)
  })
})

describe('an agent-set colour', () => {
  it('takes a palette name, whatever case it is written in', () => {
    expect(resolveAnswerColor('mint', 0)).toBe(ANSWER_PALETTE.mint)
    expect(resolveAnswerColor('MINT', 0)).toBe(ANSWER_PALETTE.mint)
  })

  it('takes six hex digits', () => {
    expect(resolveAnswerColor('#1E3A8A', 0)).toBe('#1e3a8a')
  })

  it('falls back to the walk for anything else', () => {
    const fallback = resolveAnswerColor(undefined, 2)
    for (const bad of ['url(x)', 'red', '#fff', '#12345g', 'blue; color: red', '']) {
      expect(resolveAnswerColor(bad, 2), bad).toBe(fallback)
    }
  })
})

describe('the label colour', () => {
  it('is the answer colour itself on every palette entry', () => {
    for (const name of names) {
      expect(answerTextColor(ANSWER_PALETTE[name]), name).toBe(ANSWER_PALETTE[name])
    }
  })

  it('falls back to the page text on a dark colour an agent chose', () => {
    expect(answerTextColor('#1e3a8a')).toBe('var(--color-text)')
    expect(answerTextColor('#000000')).toBe('var(--color-text)')
  })

  it('is carried, with the outline colour, on the two custom properties the button reads', () => {
    expect(answerStyles(['Roll it'], ['mint'])).toEqual([
      { '--answer-color': ANSWER_PALETTE.mint, '--answer-fg': ANSWER_PALETTE.mint },
    ])
    expect(answerStyles(['Roll it'], ['#1e3a8a'])).toEqual([
      { '--answer-color': '#1e3a8a', '--answer-fg': 'var(--color-text)' },
    ])
  })
})

// One question's colours are worked out together, not one option at a time,
// which is the only way the walk can avoid what the agent has taken.
const colors = (labels: string[], colors?: (string | undefined)[]) =>
  answerStyles(labels, colors).map((style) => (style as Record<string, string>)['--answer-color'])

describe('a question with some colours set and some not', () => {
  it('walks past anything the agent claimed', () => {
    // "Roll it" blue by name, "Wait" amber, and the third left alone: the walk
    // starts at blue, which would have given the row two blue buttons.
    const out = colors(['Roll it', 'Wait', 'Roll at 5%'], ['blue', 'amber', undefined])
    expect(out[0]).toBe(ANSWER_PALETTE.blue)
    expect(out[1]).toBe(ANSWER_PALETTE.amber)
    expect(out[2]).toBe(ANSWER_PALETTE.violet)
  })

  it('walks blue, violet, amber for three labels on neither list', () => {
    expect(colors(['Roll it', 'Wait', 'Roll at 5%'])).toEqual([
      ANSWER_PALETTE.blue,
      ANSWER_PALETTE.violet,
      ANSWER_PALETTE.amber,
    ])
  })

  it('ignores a value it cannot resolve and colours that option from the walk', () => {
    const out = colors(['Roll it', 'Wait'], ['url(x)', undefined])
    expect(out).toEqual([ANSWER_PALETTE.blue, ANSWER_PALETTE.violet])
    expect(overrideColor('url(x)')).toBe(null)
  })

  it('repeats rather than running out when every colour is spoken for', () => {
    const out = colors(
      Array.from({ length: 9 }, (_, i) => `Option ${i}`),
      [...names, undefined],
    )
    expect(out).toHaveLength(9)
    expect(out[8]).toBe(ANSWER_PALETTE.blue)
  })

  it('never reaches for mint or rose, however many options there are', () => {
    const out = colors(Array.from({ length: 8 }, (_, i) => `Option ${i}`))
    for (const c of out) expect(SPOKEN_FOR.has(c)).toBe(false)
  })
})

// A "yes" and a "no" in two arbitrary colours make the eye stop and read. The
// two lists are the one case where the colour is the answer, not a tag.
describe('the affirm and deny lists', () => {
  const color = (label: string) =>
    (answerStyles([label])[0] as Record<string, string>)['--answer-color']

  it('paints an affirmative green and a denial red', () => {
    for (const yes of ['Yes', 'yes', 'OK', 'Correct', 'Go ahead', 'LGTM', 'Approve'])
      expect(color(yes), yes).toBe(ANSWER_PALETTE.mint)
    for (const no of ['No', 'no', 'Wrong', 'Incorrect', 'Cancel', "Don't", 'Not now'])
      expect(color(no), no).toBe(ANSWER_PALETTE.rose)
  })

  it('ignores case and a trailing full stop', () => {
    expect(wordColor('YES.')).toBe(ANSWER_PALETTE.mint)
    expect(wordColor('  no!  ')).toBe(ANSWER_PALETTE.rose)
  })

  it('matches the whole label, never a word inside it', () => {
    for (const label of ['Yes, but hold', 'Nope, not now', 'No route to host', 'Right rail'])
      expect(wordColor(label), label).toBe(null)
  })

  it('says nothing about a label that says nothing', () => {
    for (const label of ['Roll it', 'Wait', 'Tombstone', 'Roll at 5%'])
      expect(wordColor(label), label).toBe(null)
  })

  it('gives a yes/no question green and red, in that order', () => {
    expect(colors(['Yes', 'No'])).toEqual([ANSWER_PALETTE.mint, ANSWER_PALETTE.rose])
  })

  it('gives a third, neutral option the first colour of the walk', () => {
    expect(colors(['Yes', 'No', 'Ask me later'])).toEqual([
      ANSWER_PALETTE.mint,
      ANSWER_PALETTE.rose,
      ANSWER_PALETTE.blue,
    ])
  })

  it('lets the agent overrule what the label says', () => {
    expect(colors(['Yes', 'No'], ['amber', undefined])).toEqual([
      ANSWER_PALETTE.amber,
      ANSWER_PALETTE.rose,
    ])
  })
})
