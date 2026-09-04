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

const REPLY = { action: 'reply', type: 'text', title: 'Reply', placeholder: 'Your answer' }

function actionsFor(
  maxActions: number | undefined,
  answers: string[],
  data: Record<string, unknown> = {},
) {
  const { context } = loadSw({ maxActions })
  const fn = runInContext('actionsForNotification', context) as (data: unknown) => unknown[]
  return fn({ kind: 'question', quickAnswers: quickAnswers(answers), ...data }) as {
    action: string
    title: string
  }[]
}

const two = ['Yes', 'No']
const three = ['A', 'B', 'C']

// The rule for the action row: the options the agent sent, and Reply in a spare
// slot so a question with no options can still be answered in words.
describe('service worker notification actions', () => {
  it('shows nothing when the browser reports no action slots', () => {
    expect(actionsFor(0, two)).toEqual([])
    expect(actionsFor(0, three)).toEqual([])
    expect(actionsFor(0, [])).toEqual([])
  })

  it('shows nothing when Notification.maxActions is missing', () => {
    expect(actionsFor(undefined, two)).toEqual([])
  })

  it('shows nothing on an event that is not a question', () => {
    expect(actionsFor(2, two, { kind: 'update' })).toEqual([])
  })

  it('shows nothing on an encrypted question, which the worker cannot read', () => {
    expect(actionsFor(2, two, { encrypted: true })).toEqual([])
    expect(actionsFor(3, [], { encrypted: true })).toEqual([])
  })

  it('gives the spare slot to Reply', () => {
    expect(actionsFor(2, [])).toEqual([REPLY])
    expect(actionsFor(1, [])).toEqual([REPLY])
    expect(actionsFor(3, two)).toEqual([
      { action: 'answer-0', title: 'Yes' },
      { action: 'answer-1', title: 'No' },
      REPLY,
    ])
  })

  it('keeps both options when two answers fill the two slots', () => {
    expect(actionsFor(2, two)).toEqual([
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

  it('drops to one answer plus Reply when three answers need two slots', () => {
    expect(actionsFor(2, three)).toEqual([{ action: 'answer-0', title: 'A' }, REPLY])
    expect(actionsFor(1, two)).toEqual([REPLY])
  })

  it('names Reply as an inline text action', () => {
    const [reply] = actionsFor(1, [])
    expect(reply).toEqual({
      action: 'reply',
      type: 'text',
      title: 'Reply',
      placeholder: 'Your answer',
    })
  })

  it('offers Reply alone when there are no usable quick answers', () => {
    const { context } = loadSw({ maxActions: 2 })
    const fn = runInContext('actionsForNotification', context) as (data: unknown) => unknown[]
    expect(fn({ kind: 'question', quickAnswers: 'nope' })).toEqual([REPLY])
    expect(fn({ kind: 'question', quickAnswers: [{ action: 1, title: 2 }] })).toEqual([REPLY])
    expect(fn({ kind: 'question' })).toEqual([REPLY])
  })
})

// An answer from a notification POSTs to the API from the service worker. The
// session cookie can be gone by then (expired, or logged out on this device),
// and a silent failure would drop the answer on the floor.
describe('service worker notification clicks', () => {
  async function click(harness: SwHarness, action: string, reply?: string) {
    let waited: Promise<unknown> = Promise.resolve()
    harness.listeners.notificationclick({
      action,
      reply,
      notification: {
        close: () => {},
        data: {
          url: '/event/01EVENT',
          eventId: '01EVENT',
          kind: 'question',
          quickAnswers: quickAnswers(['Yes', 'No']),
        },
      },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise
      },
    })
    await waited
  }

  function posted(harness: SwHarness) {
    const [url, init] = harness.fetch.mock.calls[0] as [URL, RequestInit]
    return { url: String(url), body: JSON.parse(String(init.body)) }
  }

  it('posts the option and opens nothing when the API accepts it', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, 'answer-0')

    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(posted(harness)).toEqual({
      url: 'https://hub.test/api/v1/questions/01EVENT/answer',
      body: { answer: { choice: 'Yes' }, if_pending: true },
    })
    expect(harness.openWindow).not.toHaveBeenCalled()
  })

  it('posts the typed words and opens nothing', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, 'reply', '  wait for QA  ')

    expect(posted(harness).body).toEqual({ text: 'wait for QA', if_pending: true })
    expect(harness.openWindow).not.toHaveBeenCalled()
  })

  // A browser without inline text shows Reply as a plain button, so the tap
  // carries no words and the thread is the place to answer.
  it('opens the thread when Reply arrives with no words', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, 'reply')

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/event/01EVENT')
  })

  it('opens the thread when the question was answered in the meantime', async () => {
    const harness = loadSw({ maxActions: 2, fetchStatus: 409 })
    await click(harness, 'reply', 'too late')

    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/event/01EVENT')
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

  it('opens the thread for an unknown action without posting anything', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, 'more')

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/event/01EVENT')
  })

  it('opens the thread on a body tap, with no action at all', async () => {
    const harness = loadSw({ maxActions: 2 })
    await click(harness, '')

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.openWindow).toHaveBeenCalledWith('https://hub.test/event/01EVENT')
  })
})
