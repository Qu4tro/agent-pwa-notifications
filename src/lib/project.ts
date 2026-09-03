// The three things colour is allowed to say, and nothing else: which kind of
// event this is, which project it belongs to, and what state a question is in.
// Every value here resolves to a token declared once in src/styles.css.

export type Kind = 'update' | 'question' | 'done' | 'error'

// One colour per project, picked by name so the same project keeps its colour
// across pages. Only the dot is tinted; the text stays --color-text.
const PALETTE = [
  '#5b9bff',
  '#a78bfa',
  '#34d399',
  '#f87171',
  '#fbbf24',
  '#22d3ee',
  '#f472b6',
  '#a3e635',
]

export function projectColor(name: string): string {
  if (!name) return 'var(--color-faint)'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export const KIND_LABEL: Record<string, string> = {
  update: 'Update',
  question: 'Question',
  done: 'Done',
  error: 'Error',
}

// Written out in full so Tailwind sees the class names in the source.
export const KIND_TEXT: Record<string, string> = {
  update: 'text-kind-update',
  question: 'text-kind-question',
  done: 'text-kind-done',
  error: 'text-kind-error',
}

// The same four colours as a 3px rail and as an unread dot. Written out in
// full for the same reason as KIND_TEXT.
export const KIND_BORDER: Record<string, string> = {
  update: 'border-l-kind-update',
  question: 'border-l-kind-question',
  done: 'border-l-kind-done',
  error: 'border-l-kind-error',
}
export const KIND_BG: Record<string, string> = {
  update: 'bg-kind-update',
  question: 'bg-kind-question',
  done: 'bg-kind-done',
  error: 'bg-kind-error',
}

// Question state. Pending borrows the question colour, answered the done
// colour, expired stays muted: no state has a colour of its own.
export const STATE_TEXT = {
  pending: 'text-kind-question',
  answered: 'text-kind-done',
  expired: 'text-muted',
} as const

// The "No project" bucket is project === ''. URLs can't carry an empty
// segment, so map it to a reserved token both ways.
const NONE = '__none__'
export function toParam(project: string): string {
  return project === '' ? NONE : project
}
export function fromParam(name: string): string {
  return name === NONE ? '' : name
}
export function projectLabel(project: string): string {
  return project === '' ? 'No project' : project
}
