import { describe, expect, it } from 'vitest'
import {
  ANSWER_PALETTE,
  answerStyles,
  answerTextColor,
  overrideColor,
  resolveAnswerColor,
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
    expect(answerStyles(1, ['mint'])).toEqual([
      { '--answer-bg': ANSWER_PALETTE.mint, '--answer-fg': 'var(--color-bg)' },
    ])
  })
})

// One question's colours are worked out together, not one option at a time,
// which is the only way the palette can avoid what the agent has taken.
describe('a question with some colours set and some not', () => {
  const fills = (count: number, colors?: (string | undefined)[]) =>
    answerStyles(count, colors).map((style) => (style as Record<string, string>)['--answer-bg'])

  it('walks the palette past anything the agent claimed', () => {
    // "Roll it" mint, "Wait" amber, and the third left alone: index 2 of the
    // palette is mint, which would have given the row two mint buttons.
    const out = fills(3, ['mint', 'amber', undefined])
    expect(out[0]).toBe(ANSWER_PALETTE.mint)
    expect(out[1]).toBe(ANSWER_PALETTE.amber)
    expect(new Set(out).size).toBe(3)
  })

  it('leaves the plain case exactly as it was', () => {
    expect(fills(3)).toEqual([ANSWER_PALETTE.blue, ANSWER_PALETTE.violet, ANSWER_PALETTE.mint])
  })

  it('ignores a value it cannot resolve and colours that option from the palette', () => {
    const out = fills(2, ['url(x)', undefined])
    expect(out).toEqual([ANSWER_PALETTE.blue, ANSWER_PALETTE.violet])
    expect(overrideColor('url(x)')).toBe(null)
  })

  it('repeats rather than running out when every colour is spoken for', () => {
    const named = Object.keys(ANSWER_PALETTE)
    const out = fills(9, [...named, undefined])
    expect(out).toHaveLength(9)
    expect(out[8]).toBe(ANSWER_PALETTE.blue)
  })
})
