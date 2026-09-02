import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// public/sw.js is plain script-scope JavaScript for the browser, so load it in
// a vm with a stubbed `self` and read the top-level functions off the context.
// This pins the notification behaviour without a browser.
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

interface SwHarness {
  context: Record<string, unknown>
  listeners: Record<string, (event: any) => void>
  openWindow: ReturnType<typeof vi.fn>
  fetch: ReturnType<typeof vi.fn>
}

function loadSw(options: { maxActions?: number; fetchStatus?: number } = {}): SwHarness {
  const listeners: Record<string, (event: any) => void> = {}
  const openWindow = vi.fn(async () => null)
  const status = options.fetchStatus ?? 200
  const fetchStub = vi.fn(async () => ({ ok: status < 400, status }))

  const self: Record<string, unknown> = {
    addEventListener: (name: string, fn: (event: any) => void) => {
      listeners[name] = fn
    },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow },
    registration: { showNotification: async () => {} },
    location: { origin: 'https://hub.test' },
  }
  if (options.maxActions !== undefined) self.Notification = { maxActions: options.maxActions }

  const context = createContext({ self, console, URL, fetch: fetchStub })
  runInContext(source, context)
  return { context, listeners, openWindow, fetch: fetchStub }
}

function quickAnswers(titles: string[]) {
  return titles.map((title, index) => ({
    action: `answer-${index}`,
    title,
    answer: { choice: title },
  }))
}

function actionsFor(maxActions: number | undefined, answers: string[]) {
  const { context } = loadSw({ maxActions })
  const fn = runInContext('actionsForNotification', context) as (data: unknown) => unknown[]
  return fn({ quickAnswers: quickAnswers(answers) }) as { action: string; title: string }[]
}

const two = ['Yes', 'No']
const three = ['A', 'B', 'C']

describe('service worker notification actions', () => {
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

  // Phase 2 rule: if every answer fits, show only the answers. Tapping the
  // notification body still opens the thread, so More earns nothing here.
  it('leaves a spare slot empty rather than adding More', () => {
    expect(actionsFor(3, two)).toEqual([
      { action: 'answer-0', title: 'Yes' },
      { action: 'answer-1', title: 'No' },
    ])
  })

  it('shows all three answers when three slots exist', () => {
    expect(actionsFor(3, three)).toEqual([
      { action: 'answer-0', title: 'A' },
      { action: 'answer-1', title: 'B' },
      { action: 'answer-2', title: 'C' },
    ])
  })

  it('shows no actions at all when there are no usable quick answers', () => {
    const { context } = loadSw({ maxActions: 2 })
    const fn = runInContext('actionsForNotification', context) as (data: unknown) => unknown[]
    expect(fn({ quickAnswers: 'nope' })).toEqual([])
    expect(fn({ quickAnswers: [{ action: 1, title: 2 }] })).toEqual([])
    expect(fn({})).toEqual([])
  })
})

// A quick answer POSTs to the API from the service worker. The session cookie
// can be gone by then (expired, or logged out on this device), and a silent
// failure would drop the answer on the floor.
describe('service worker notification clicks', () => {
  async function click(harness: SwHarness, action: string) {
    let waited: Promise<unknown> = Promise.resolve()
    harness.listeners.notificationclick({
      action,
      notification: {
        close: () => {},
        data: {
          url: '/event/01EVENT',
          eventId: '01EVENT',
          quickAnswers: quickAnswers(['Yes', 'No']),
        },
      },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise
      },
    })
    await waited
  }

  it('posts the answer and opens nothing when the API accepts it', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, 'answer-0')

    expect(harness.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = harness.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://hub.test/api/v1/questions/01EVENT/answer')
    expect(init.body).toBe(JSON.stringify({ choice: 'Yes' }))
    expect(harness.openWindow).not.toHaveBeenCalled()
  })

  it('opens the login page with a next path when the session has gone', async () => {
    const harness = loadSw({ maxActions: 2, fetchStatus: 401 })
    await click(harness, 'answer-1')

    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/login?next=%2Fevent%2F01EVENT')
  })

  it('opens the thread when the answer fails for any other reason', async () => {
    const harness = loadSw({ maxActions: 2, fetchStatus: 500 })
    await click(harness, 'answer-0')

    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/event/01EVENT')
  })

  it('opens the thread for the More action without posting anything', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, 'more')

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/event/01EVENT')
  })
})
