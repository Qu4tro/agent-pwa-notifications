import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// public/sw.js is plain script-scope JavaScript for the browser, so load it in
// a vm with a stubbed `self` and read the top-level function off the context.
// This pins the notification action rule without a browser.
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function actionsFor(maxActions: number | undefined, answers: string[]) {
  const self: Record<string, unknown> = {
    addEventListener: () => {},
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => null },
    registration: { showNotification: async () => {} },
    location: { origin: 'https://hub.test' },
  }
  if (maxActions !== undefined) self.Notification = { maxActions }

  const context = createContext({ self, console, URL, fetch: async () => new globalThis.Response() })
  runInContext(source, context)

  const data = {
    quickAnswers: answers.map((title, index) => ({
      action: `answer-${index}`,
      title,
      answer: { choice: title },
    })),
  }
  return runInContext('actionsForNotification', context)(data) as { action: string; title: string }[]
}

const two = ['Yes', 'No']
const three = ['A', 'B', 'C']

describe('service worker notification actions (current rule)', () => {
  it('shows nothing when the browser reports no action slots', () => {
    expect(actionsFor(0, two)).toEqual([])
    expect(actionsFor(0, three)).toEqual([])
  })

  it('shows nothing when Notification.maxActions is missing', () => {
    expect(actionsFor(undefined, two)).toEqual([])
  })

  it('collapses to a single More action when only one slot exists', () => {
    expect(actionsFor(1, two)).toEqual([{ action: 'more', title: 'More' }])
    expect(actionsFor(1, three)).toEqual([{ action: 'more', title: 'More' }])
  })

  it('shows both answers when two answers fill the two slots', () => {
    expect(actionsFor(2, two)).toEqual([
      { action: 'answer-0', title: 'Yes' },
      { action: 'answer-1', title: 'No' },
    ])
  })

  it('drops to one answer plus More when three answers need two slots', () => {
    expect(actionsFor(2, three)).toEqual([
      { action: 'answer-0', title: 'A' },
      { action: 'more', title: 'More' },
    ])
  })

  // Phase 2 changes this: with a spare slot the answers should stand alone.
  it('appends More when a slot is spare', () => {
    expect(actionsFor(3, two)).toEqual([
      { action: 'answer-0', title: 'Yes' },
      { action: 'answer-1', title: 'No' },
      { action: 'more', title: 'More' },
    ])
  })

  it('shows all three answers when three slots exist', () => {
    expect(actionsFor(3, three)).toEqual([
      { action: 'answer-0', title: 'A' },
      { action: 'answer-1', title: 'B' },
      { action: 'answer-2', title: 'C' },
    ])
  })

  it('ignores malformed quick answers', () => {
    const self: Record<string, unknown> = {
      addEventListener: () => {},
      Notification: { maxActions: 2 },
    }
    const context = createContext({ self, console, URL })
    runInContext(source, context)
    const fn = runInContext('actionsForNotification', context) as (d: unknown) => unknown[]
    expect(fn({ quickAnswers: 'nope' })).toEqual([{ action: 'more', title: 'More' }])
    expect(fn({ quickAnswers: [{ action: 1, title: 2 }] })).toEqual([
      { action: 'more', title: 'More' },
    ])
  })
})
