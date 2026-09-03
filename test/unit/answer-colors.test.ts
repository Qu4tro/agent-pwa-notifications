import { describe, expect, it } from 'vitest'
import {
  ANSWER_PALETTE,
  answerStyle,
  answerTextColor,
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
    expect(answerStyle(0, 'mint')).toEqual({
      '--answer-bg': ANSWER_PALETTE.mint,
      '--answer-fg': 'var(--color-bg)',
    })
  })
})
