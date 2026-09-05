// Which theme the app is drawn in. A theme is a second set of values for the
// tokens src/styles.css declares and nothing else: every utility compiles to
// `var(--color-...)`, so re-declaring those variables under a `data-theme` on
// <html> repaints the whole app and no component ever learns a theme exists.
//
// The choice is a browser fact, like the encryption key and the push
// subscription: it belongs to this device, not to the account, so it lives in
// localStorage and never goes to the server.

const THEME_STORE = 'ad_theme'

export interface Theme {
  id: string
  // What the setting calls it.
  name: string
  // One line on what it looks like, so the choice can be made without making it.
  note: string
  // What the browser chrome is painted with while this theme is on: the
  // <meta name="theme-color"> the document ships with, kept in step so the
  // notch and the address bar are the same surface as the app under them.
  chrome: string
  // Four colours out of the theme, for the swatch beside its name: the page,
  // the strip along the top of it, the text on the page, and the accent.
  swatch: { page: string; bar: string; text: string; accent: string }
}

// The default is the app as src/styles.css draws it, and carries no
// `data-theme` at all - it is what an unthemed document already is.
export const THEMES: Theme[] = [
  {
    id: 'default',
    name: 'Default',
    note: 'Dark and quiet, for a phone at night.',
    chrome: '#0f1115',
    swatch: { page: '#0f1115', bar: '#161920', text: '#e6e8ee', accent: '#a78bfa' },
  },
  {
    id: 'win95',
    name: 'Windows 95',
    note: 'Grey bevels, a navy title bar and the teal desktop behind it.',
    chrome: '#000080',
    swatch: { page: '#c0c0c0', bar: '#000080', text: '#000000', accent: '#800080' },
  },
]

export const DEFAULT_THEME = THEMES[0].id

// A stored value is whatever was in localStorage the last time this device
// chose, which may be a theme that has since been removed or a value nothing
// wrote. Anything that is not a theme is the default.
export function themeId(value: string | null | undefined): string {
  return THEMES.some((t) => t.id === value) ? (value as string) : DEFAULT_THEME
}

export function getTheme(): string {
  try {
    return themeId(localStorage.getItem(THEME_STORE))
  } catch {
    return DEFAULT_THEME
  }
}

// Paint the theme on the document. The attribute is dropped rather than set to
// `default`, so the unthemed document and the document that chose the default
// are the same document.
export function applyTheme(id: string) {
  const theme = THEMES.find((t) => t.id === themeId(id)) as Theme
  const root = document.documentElement
  if (theme.id === DEFAULT_THEME) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme.id)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.chrome)
}

export function setTheme(id: string) {
  const chosen = themeId(id)
  try {
    localStorage.setItem(THEME_STORE, chosen)
  } catch {
    /* a device that will not store it still gets the theme for this visit */
  }
  applyTheme(chosen)
}

// The same three lines, as one statement the document runs before it paints.
// It has to be inline and it has to be blocking: read from a React effect the
// first frame is the default theme, and a themed device would see a dark page
// flash grey. Written from the constants above, so a theme added there needs
// nothing here.
export const THEME_BOOT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORE,
)});var c=${JSON.stringify(
  Object.fromEntries(THEMES.map((t) => [t.id, t.chrome])),
)};if(!s||!(s in c)||s===${JSON.stringify(DEFAULT_THEME)})return;document.documentElement.setAttribute('data-theme',s);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',c[s])}catch(e){}})()`
