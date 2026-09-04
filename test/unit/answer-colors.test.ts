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

const names = Object.keys(ANSWER_PALETTE)

describe('the palette', () => {
  it('gives every option its own colour until it runs out', () => {
    const eight = Array.from({ length: 8 }, (_, i) => resolveAnswerColor(undefined, i))
    expect(new Set(eight).size).toBe(8)
  })

  it('wraps by index, so a ninth option starts again', () => {
    expect(resolveAnswerColor(undefined, 8)).toBe(resolveAnswerColor(undefined, 0))
    expect(resolveAnswerColor(undefined, 11)).toBe(resolveAnswerColor(undefined, 3))
  })

  it('keeps the app background above 10:1 on every entry', () => {
    for (const [name, hex] of Object.entries(ANSWER_PALETTE)) {
      expect(contrast(hex, '#0f1115'), name).toBeGreaterThan(10)
    }
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

  it('falls back to the palette for anything else', () => {
    const fallback = resolveAnswerColor(undefined, 2)
    for (const bad of ['url(x)', 'red', '#fff', '#12345g', 'blue; color: red', '']) {
      expect(resolveAnswerColor(bad, 2), bad).toBe(fallback)
    }
  })
})

describe('the label colour', () => {
  it('is the dark one on every palette entry', () => {
    for (const name of names) {
      expect(answerTextColor(ANSWER_PALETTE[name as keyof typeof ANSWER_PALETTE]), name).toBe(
        'var(--color-bg)',
      )
    }
  })

  it('flips to the light one on a dark fill an agent chose', () => {
    expect(answerTextColor('#1e3a8a')).toBe('var(--color-text)')
    expect(answerTextColor('#000000')).toBe('var(--color-text)')
  })

  it('is carried on the two custom properties the button reads', () => {
    expect(answerStyles(['Roll it'], ['mint'])).toEqual([
      { '--answer-bg': ANSWER_PALETTE.mint, '--answer-fg': 'var(--color-bg)' },
    ])
  })
})

// One question's colours are worked out together, not one option at a time,
// which is the only way the palette can avoid what the agent has taken.
const fills = (labels: string[], colors?: (string | undefined)[]) =>
  answerStyles(labels, colors).map((style) => (style as Record<string, string>)['--answer-bg'])

describe('a question with some colours set and some not', () => {
  it('walks the palette past anything the agent claimed', () => {
    // "Roll it" mint, "Wait" amber, and the third left alone: index 2 of the
    // palette is mint, which would have given the row two mint buttons.
    const out = fills(['Roll it', 'Wait', 'Roll at 5%'], ['mint', 'amber', undefined])
    expect(out[0]).toBe(ANSWER_PALETTE.mint)
    expect(out[1]).toBe(ANSWER_PALETTE.amber)
    expect(new Set(out).size).toBe(3)
  })

  it('leaves the plain case exactly as it was', () => {
    expect(fills(['Roll it', 'Wait', 'Roll at 5%'])).toEqual([
      ANSWER_PALETTE.blue,
      ANSWER_PALETTE.violet,
      ANSWER_PALETTE.mint,
    ])
  })

  it('ignores a value it cannot resolve and colours that option from the palette', () => {
    const out = fills(['Roll it', 'Wait'], ['url(x)', undefined])
    expect(out).toEqual([ANSWER_PALETTE.blue, ANSWER_PALETTE.violet])
    expect(overrideColor('url(x)')).toBe(null)
  })

  it('repeats rather than running out when every colour is spoken for', () => {
    const named = Object.keys(ANSWER_PALETTE)
    const out = fills(
      Array.from({ length: 9 }, (_, i) => `Option ${i}`),
      [...named, undefined],
    )
    expect(out).toHaveLength(9)
    expect(out[8]).toBe(ANSWER_PALETTE.blue)
  })
})

// A "yes" and a "no" in two arbitrary pastels make the eye stop and read. The
// two lists are the one case where the colour is the answer, not a tag.
describe('the affirm and deny lists', () => {
  const fill = (label: string) =>
    (answerStyles([label])[0] as Record<string, string>)['--answer-bg']

  it('paints an affirmative green and a denial red', () => {
    for (const yes of ['Yes', 'yes', 'OK', 'Correct', 'Go ahead', 'LGTM', 'Approve'])
      expect(fill(yes), yes).toBe(ANSWER_PALETTE.mint)
    for (const no of ['No', 'no', 'Wrong', 'Incorrect', 'Cancel', "Don't", 'Not now'])
      expect(fill(no), no).toBe(ANSWER_PALETTE.rose)
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
    expect(fills(['Yes', 'No'])).toEqual([ANSWER_PALETTE.mint, ANSWER_PALETTE.rose])
  })

  it('keeps the palette off the two colours the words have taken', () => {
    const out = fills(['Yes', 'No', 'Ask me later'])
    expect(out[0]).toBe(ANSWER_PALETTE.mint)
    expect(out[1]).toBe(ANSWER_PALETTE.rose)
    expect(new Set(out).size).toBe(3)
  })

  it('lets the agent overrule what the label says', () => {
    expect(fills(['Yes', 'No'], ['amber', undefined])).toEqual([
      ANSWER_PALETTE.amber,
      ANSWER_PALETTE.rose,
    ])
  })
})

// The order is the contract: what the agent set, then what the label says,
// then position. The CLI's --color is rule 1, and rule 1 always wins.
describe('the order the three rules run in', () => {
  it('puts what the agent set above everything, on a yes as much as on a label', () => {
    expect(fills(['Yes', 'No', 'Ask me later'], ['cyan', 'lime', 'pink'])).toEqual([
      ANSWER_PALETTE.cyan,
      ANSWER_PALETTE.lime,
      ANSWER_PALETTE.pink,
    ])
  })

  it('will even paint an affirmative red, because the agent asked', () => {
    expect(fills(['Yes'], ['rose'])).toEqual([ANSWER_PALETTE.rose])
  })

  it('falls to the label, not to the palette, when the value does not resolve', () => {
    expect(fills(['Yes', 'No'], ['url(x)', '#fff'])).toEqual([
      ANSWER_PALETTE.mint,
      ANSWER_PALETTE.rose,
    ])
  })

  it('colours the options past the end of a short list by label, then by place', () => {
    expect(fills(['Hold', 'Yes', 'Maybe'], ['amber'])).toEqual([
      ANSWER_PALETTE.amber,
      ANSWER_PALETTE.mint,
      ANSWER_PALETTE.blue,
    ])
  })
})
