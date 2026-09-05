import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES, THEME_BOOT, themeId } from '../../src/lib/theme'
import { ANSWER_PALETTE } from '../../src/lib/answers'

// A theme is a second set of values for the tokens src/styles.css declares, so
// what can go wrong with one is not what it looks like: a token added to the
// default and forgotten in a theme, which then quietly inherits a colour drawn
// for a black page onto a grey one, and a palette that reads on the default's
// near-black and not on this theme's face. Both are read out of the CSS here.

// Comments in these files talk about the tokens by name - "--color-bg is the
// window face" - so they are taken out before anything is read as a
// declaration.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// The tokens the default theme declares, out of the @theme block, and the ones
// a theme re-declares, out of its html[data-theme='...'] block. Both are flat
// lists of `--name: value;` and are read the same way.
function tokens(css: string, open: RegExp): Record<string, string> {
  const start = css.search(open)
  if (start < 0) throw new Error(`no block matching ${open}`)
  const from = css.indexOf('{', start)
  // The blocks hold no nested braces, so the first closing one ends them.
  const body = css.slice(from + 1, css.indexOf('}', from))
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[name] = value.trim()
  return out
}

const styles = read('../../src/styles.css')
const base = tokens(styles, /@theme\s*\{/)
const win95 = tokens(read('../../src/themes/win95.css'), /html\[data-theme='win95'\]\s*\{/)

// WCAG relative luminance and contrast, worked out here rather than imported,
// so the test does not check the palette against its own arithmetic.
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
// What color-mix(in srgb, colour amount%, over) paints, as a hex the label can
// be checked against. The same sum as answerFills in src/lib/answers.ts.
function mix(color: string, over: string, amount: number): string {
  const at = (hex: string, i: number) => parseInt(hex.slice(1 + i, 3 + i), 16)
  const channel = (i: number) => Math.round(at(color, i) * amount + at(over, i) * (1 - amount))
  return '#' + [0, 2, 4].map((i) => channel(i).toString(16).padStart(2, '0')).join('')
}

describe('the themes', () => {
  it('names one theme per data-theme block, and the default has none', () => {
    const ids = THEMES.map((t) => t.id)
    expect(ids).toContain(DEFAULT_THEME)
    expect(new Set(ids).size).toBe(ids.length)
    // The default theme is the app with no attribute on it, so a block for it
    // would be a second, unreachable copy of src/styles.css.
    expect(styles).not.toContain(`data-theme='${DEFAULT_THEME}'`)
    for (const id of ids.filter((i) => i !== DEFAULT_THEME)) {
      expect(styles).toContain(`./themes/${id}.css`)
      expect(read(`../../src/themes/${id}.css`)).toContain(`html[data-theme='${id}']`)
    }
  })

  it('re-declares every token the default declares', () => {
    // Anything left out falls back to the default's value, which on a light
    // theme is a colour drawn to be read on near-black.
    expect(Object.keys(base).filter((token) => !(token in win95))).toEqual([])
    // What it adds on top is the theme's own - the bevels, the desktop - and
    // stays under its own prefix, where no utility can reach it.
    for (const token of Object.keys(win95)) {
      if (!(token in base)) expect(token).toMatch(/^--w95-/)
    }
  })

  it('carries the browser chrome the theme is actually painted in', () => {
    // The default's is the page colour, and the document ships with it in a
    // meta tag that THEME_BOOT rewrites; a drift there shows as a notch in
    // one colour and an app in another.
    const fallback = THEMES.find((t) => t.id === DEFAULT_THEME)
    expect(fallback?.chrome).toBe(base['--color-bg'])
    expect(read('../../src/routes/__root.tsx')).toContain(
      `{ name: 'theme-color', content: '${fallback?.chrome}' }`,
    )
    for (const theme of THEMES) expect(theme.chrome).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("shows each theme in that theme's own colours", () => {
    // The swatch beside a theme name is painted from four values carried in
    // src/lib/theme.ts, because it has to show a theme that is not on. They
    // are that theme's own tokens, and this is what stops them drifting from
    // the stylesheet they were copied out of.
    const declared: Record<string, Record<string, string>> = { default: base, win95 }
    // The strip along the top of the swatch is the header, which in the
    // default theme is the surface and in Windows 95 is the title bar.
    const bar: Record<string, string> = { default: '--color-surface', win95: '--w95-title' }
    for (const theme of THEMES) {
      const token = declared[theme.id]
      expect(theme.swatch.page, theme.id).toBe(token['--color-bg'])
      expect(theme.swatch.text, theme.id).toBe(token['--color-text'])
      expect(theme.swatch.accent, theme.id).toBe(token['--color-kind-question'])
      expect(theme.swatch.bar, theme.id).toBe(token[bar[theme.id]])
    }
  })

  it('reads anything but a theme as the default', () => {
    expect(themeId(null)).toBe(DEFAULT_THEME)
    expect(themeId(undefined)).toBe(DEFAULT_THEME)
    expect(themeId('')).toBe(DEFAULT_THEME)
    expect(themeId('win98')).toBe(DEFAULT_THEME)
    expect(themeId('win95')).toBe('win95')
  })

  it('boots from the same key and colours the module writes', () => {
    expect(THEME_BOOT).toContain('ad_theme')
    expect(THEME_BOOT).toContain('data-theme')
    for (const theme of THEMES) expect(THEME_BOOT).toContain(theme.chrome)
    // It runs before hydration on every load, so a throw there is a blank page.
    expect(THEME_BOOT).toContain('try')
    expect(() => new Function(THEME_BOOT)).not.toThrow()
  })
})

// Windows 95 puts words on a grey face, where the default puts them on
// near-black. Every ratio the default theme documents has to hold again here,
// against this theme's own two surfaces.
describe('the Windows 95 palette', () => {
  const BG = win95['--color-bg']
  const SURFACE = win95['--color-surface']
  const surfaces = { '--color-bg': BG, '--color-surface': SURFACE }

  it('is written in six hex digits throughout', () => {
    for (const [name, value] of Object.entries(win95)) {
      if (name.startsWith('--color-')) expect(value, name).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(Object.entries(surfaces))('carries body text on %s', (_name, surface) => {
    expect(contrast(win95['--color-text'], surface)).toBeGreaterThanOrEqual(7)
  })

  // 15px and 13px text: muted detail, the faint gutter, the kind labels and
  // the tone of a callout. 4.5:1 is what WCAG 1.4.3 asks of every one of them.
  const asText = ['--color-muted', '--color-faint', '--color-warn'].concat(
    Object.keys(win95).filter((k) => k.startsWith('--color-kind-')),
  )
  it.each(asText)('carries %s as text on both surfaces', (token) => {
    for (const surface of Object.values(surfaces)) {
      expect(contrast(win95[token], surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('draws a control boundary the eye can find', () => {
    // --color-edge is an input outline and a focus ring: 3:1 (WCAG 1.4.11).
    // --color-line is a hairline divider and carries nothing, so it is only
    // asked to be visible at all.
    for (const surface of Object.values(surfaces)) {
      expect(contrast(win95['--color-edge'], surface)).toBeGreaterThanOrEqual(3)
      expect(contrast(win95['--color-line'], surface)).toBeGreaterThan(1.2)
    }
  })

  it('carries a label on the accent fill', () => {
    // The default button and the count on the bell: --color-bg on the accent.
    expect(contrast(win95['--color-bg'], win95['--color-kind-question'])).toBeGreaterThanOrEqual(4.5)
  })

  // An answer an agent coloured is that colour mixed over the button face, at
  // the two amounts src/themes/win95.css asks color-mix for: the option, and
  // the option that stands. The label stays the page's own text on both.
  it.each(Object.entries(ANSWER_PALETTE))('carries the label on a %s answer', (_name, color) => {
    for (const amount of [0.3, 0.5]) {
      const fill = mix(color, win95['--color-raised'], amount)
      expect(contrast(win95['--color-text'], fill)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves the pointer somewhere to go', () => {
    // A soft-filled control has to change under the pointer by enough to be
    // seen and not inferred, which is what the default theme's step is for.
    expect(contrast(win95['--color-raised'], win95['--color-raised-hover'])).toBeGreaterThan(1.05)
  })
})
