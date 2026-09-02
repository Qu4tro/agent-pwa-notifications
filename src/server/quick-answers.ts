// Notification quick answers and the plaintext preview line.
//
// These are pure functions with no D1, KV or fetch dependency, so they are
// unit-testable outside the Workers runtime. `src/server/api.ts` is the only
// caller today.

import type { Block } from './blocks'

export interface QuickAnswerAction {
  action: string
  title: string
  answer: Record<string, string>
}

// The subset of an event row that the quick-answer rules look at.
export interface QuickAnswerEvent {
  kind: string
  enc: number
  title: string
  blocks: string
}

// Keep notification answers deliberately tiny. Longer or more complex
// questions remain tap-to-open, which avoids truncated or incomplete choices.
export function quickAnswerActions(event: QuickAnswerEvent): QuickAnswerAction[] {
  if (event.kind !== 'question' || event.enc === 1 || event.title.length > 80) return []
  try {
    const blocks = JSON.parse(event.blocks) as Block[]
    const interactive = blocks.filter((block) => block.type === 'buttons' || block.type === 'form')
    if (interactive.length !== 1 || interactive[0].type !== 'buttons') return []
    const button = interactive[0]
    if (button.options.length < 2 || button.options.length > 3) return []
    if (button.options.some((option) => option !== option.trim() || option.length > 20)) return []
    return button.options.map((option, index) => ({
      action: `answer-${index}`,
      title: option,
      answer: { [button.id]: option },
    }))
  } catch {
    return []
  }
}

// A short plaintext preview for the notification body.
export function previewText(blocks: Block[]): string {
  for (const b of blocks) {
    if (b.type === 'markdown') return b.text.replace(/[#*`_>]/g, '').slice(0, 140)
    if (b.type === 'callout') return b.text.slice(0, 140)
    if (b.type === 'keyvalue' && b.items[0]) return `${b.items[0].k}: ${b.items[0].v}`
  }
  return 'Open the app to see the details.'
}
