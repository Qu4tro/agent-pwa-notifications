import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANSWER_PALETTE,
  answerFills,
  answerOrder,
  answerStyles,
  overrideColor,
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

// The tokens as src/styles.css declares them. answers.ts repeats the two
// fills to work out its tints, so this is where a drift would show.
const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
const token = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`))
  if (!m) throw new Error(`no --color-${name} in styles.css`)
  return m[1]
}
const TEXT = token('text')
const BG = token('bg')
const SURFACE = token('surface')
const RAISED = token('raised')
const RAISED_HOVER = token('raised-hover')

const names = Object.keys(ANSWER_PALETTE) as (keyof typeof ANSWER_PALETTE)[]

describe('the neutral fill', () => {
  it('carries the page text on both of its steps', () => {
    expect(contrast(TEXT, RAISED)).toBeGreaterThanOrEqual(7)
    expect(contrast(TEXT, RAISED_HOVER)).toBeGreaterThanOrEqual(7)
  })

  it('stands off the surface a row wears under the pointer', () => {
    expect(luminance(RAISED)).toBeGreaterThan(luminance(SURFACE))
    expect(luminance(RAISED_HOVER)).toBeGreaterThan(luminance(RAISED))
  })
})

describe('the eight', () => {
  it('each carries the page text on its own tint, at rest and under the pointer', () => {
    for (const name of names) {
      const { fill, hover } = answerFills(ANSWER_PALETTE[name])
      expect(contrast(TEXT, fill), name).toBeGreaterThanOrEqual(4.5)
      expect(contrast(TEXT, hover), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('each tints its fill from the raised token, not from the page', () => {
    // A tint is the colour over the neutral fill, so it sits between the two.
    for (const name of names) {
      const { fill } = answerFills(ANSWER_PALETTE[name])
      expect(luminance(fill), name).toBeGreaterThan(luminance(RAISED) * 0.9)
      expect(fill, name).not.toBe(RAISED)
    }
  })

  it('is readable as the page colour on a solid fill of itself, which the option that stands wears', () => {
    for (const name of names) {
      expect(contrast(ANSWER_PALETTE[name], BG), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives every name a colour of its own', () => {
    expect(new Set(Object.values(ANSWER_PALETTE)).size).toBe(names.length)
  })
})

describe('an agent-set colour', () => {
  it('takes a palette name, whatever case it is written in', () => {
    expect(overrideColor('mint')).toBe(ANSWER_PALETTE.mint)
    expect(overrideColor('MINT')).toBe(ANSWER_PALETTE.mint)
  })

  it('takes six hex digits', () => {
    expect(overrideColor('#1E3A8A')).toBe('#1e3a8a')
  })

  it('resolves nothing else', () => {
    for (const bad of ['url(x)', 'red', '#fff', '#12345g', 'blue; color: red', '', undefined]) {
      expect(overrideColor(bad), String(bad)).toBe(null)
    }
  })
})

describe('what an option wears', () => {
  it('is nothing at all when the agent did not colour it', () => {
    expect(answerStyles(['Roll it', 'Wait', 'Roll at 5%'])).toEqual([{}, {}, {}])
  })

  it('is the colour and its two tints when the agent did', () => {
    const { fill, hover } = answerFills(ANSWER_PALETTE.mint)
    expect(answerStyles(['Roll it'], ['mint'])).toEqual([
      { '--answer-color': ANSWER_PALETTE.mint, '--answer-fill': fill, '--answer-fill-hover': hover },
    ])
  })

  it('pairs colours to options by position, and leaves the rest alone', () => {
    const out = answerStyles(['Deploy', 'Hold', 'Roll back'], ['mint', 'amber'])
    expect(out[0]).toHaveProperty('--answer-color', ANSWER_PALETTE.mint)
    expect(out[1]).toHaveProperty('--answer-color', ANSWER_PALETTE.amber)
    expect(out[2]).toEqual({})
  })

  it('treats a value it cannot resolve as no colour', () => {
    expect(answerStyles(['Roll it', 'Wait'], ['url(x)', undefined])).toEqual([{}, {}])
  })

  it('does not colour a word for what it says', () => {
    // "No" is not a danger, and "Yes" is not a success: the lists order, and
    // only the agent colours.
    expect(answerStyles(['Yes', 'No'])).toEqual([{}, {}])
  })
})

// A reader who has answered three rows knows where the yes is on the fourth
// before reading it. The two lists are the one thing the label says about
// where it stands.
describe('the order', () => {
  const order = (labels: string[]) => answerOrder(labels).map((i) => labels[i])

  it('puts an affirmative first and a denial last, whatever order they were sent', () => {
    expect(order(['Yes', 'No'])).toEqual(['Yes', 'No'])
    expect(order(['No', 'Yes'])).toEqual(['Yes', 'No'])
    expect(order(['Cancel', 'Retry'])).toEqual(['Retry', 'Cancel'])
    expect(order(['Monday', 'No', 'Staging first', 'Yes'])).toEqual([
      'Yes',
      'Monday',
      'Staging first',
      'No',
    ])
  })

  it('keeps the agent order for labels on neither list', () => {
    expect(order(['Roll it', 'Wait', 'Roll at 5%'])).toEqual(['Roll it', 'Wait', 'Roll at 5%'])
    expect(order(['Rocket', 'Flag', 'Tag', 'Bolt', 'Leaf', 'Star'])).toEqual([
      'Rocket', 'Flag', 'Tag', 'Bolt', 'Leaf', 'Star',
    ])
  })

  it('keeps the agent order within a group', () => {
    expect(order(['Approve', 'Yes', 'Reject', 'No'])).toEqual(['Approve', 'Yes', 'Reject', 'No'])
  })

  it('ignores case, surrounding space and a trailing full stop', () => {
    expect(order(['  no!  ', 'YES.'])).toEqual(['YES.', '  no!  '])
  })

  it('matches the whole label, never a word inside it', () => {
    for (const label of ['Yes, but hold', 'Nope, not now', 'No route to host', 'Right rail'])
      expect(order([label, 'Yes']), label).toEqual(['Yes', label])
  })

  it('is a permutation the caller can carry anything parallel through', () => {
    const labels = ['No', 'Maybe', 'Yes']
    const colors = ['rose', undefined, 'mint']
    const idx = answerOrder(labels)
    expect(idx).toEqual([2, 1, 0])
    expect(idx.map((i) => colors[i])).toEqual(['mint', undefined, 'rose'])
  })
})
