import { describe, expect, it } from 'vitest'
import { LIVE_START, liveQueue, liveStart, type LiveState } from '../../src/routes/_app.pending_.live'

// The live mode's whole behaviour is this function. Everything below is the
// four inputs the page can hand it - a poll, a tap, a failure, a timer - and
// what should be on the screen after each one.

const run = (state: LiveState, ...inputs: Parameters<typeof liveQueue>[1][]) =>
  inputs.reduce(liveQueue, state)

// The page's own clock, as one step: the timer that ends whatever phase it is in.
const tick = { type: 'timer' } as const
const data = (...ids: string[]) => ({ type: 'data', ids }) as const

describe('opening the page', () => {
  it('brings the first question straight in, with no breath before it', () => {
    expect(liveStart(['a', 'b'])).toMatchObject({ current: 'a', phase: 'entering', queue: ['b'] })
  })

  it('draws the calm line at once when nothing is waiting', () => {
    expect(liveStart([])).toMatchObject({ current: null, phase: 'calm', queue: [] })
  })
})

describe('an empty queue', () => {
  it('settles into the calm line after a breath, and waits there', () => {
    const calm = run(LIVE_START, data(), tick)
    expect(calm).toMatchObject({ current: null, phase: 'calm', queue: [] })
    expect(run(calm, tick)).toBe(calm)
    expect(run(calm, data())).toBe(calm)
  })

  it('lets the calm line leave before the question that ends it comes in', () => {
    const calm = run(LIVE_START, data(), tick)
    const going = liveQueue(calm, data('a'))
    expect(going).toMatchObject({ current: null, phase: 'leaving', queue: ['a'] })
    const gap = run(going, tick)
    expect(gap).toMatchObject({ current: null, phase: 'empty', queue: ['a'] })
    expect(run(gap, tick)).toMatchObject({ current: 'a', phase: 'entering', queue: [] })
  })

  it('takes a question that lands mid-breath once the breath is over', () => {
    const waiting = run(LIVE_START, data('a'))
    expect(waiting).toMatchObject({ current: null, phase: 'empty', queue: ['a'] })
    expect(run(waiting, tick)).toMatchObject({ current: 'a', phase: 'entering', queue: [] })
  })
})

describe('one question at a time', () => {
  const showing = run(LIVE_START, data('a', 'b', 'c'), tick, tick)

  it('shows one and keeps the rest in the order the server gave them', () => {
    expect(showing).toMatchObject({ current: 'a', phase: 'showing', queue: ['b', 'c'] })
  })

  it('waits for you, not for a clock', () => {
    expect(run(showing, tick)).toBe(showing)
  })

  it('acknowledges, holds, leaves, breathes, then brings the next one in', () => {
    const acked = liveQueue(showing, { type: 'answered', answer: 'Roll it' })
    expect(acked).toMatchObject({ current: 'a', phase: 'acked', answered: 'Roll it' })
    // The poll catches up while the acknowledgement is up: 'a' is answered and
    // is gone from the data. Nothing may move it.
    const polled = liveQueue(acked, data('b', 'c'))
    expect(polled).toMatchObject({ current: 'a', phase: 'acked' })

    // The acknowledgement is still on the card while the card fades, so the
    // answer is held until the card itself goes.
    const leaving = run(polled, tick)
    expect(leaving).toMatchObject({ current: 'a', phase: 'leaving', answered: 'Roll it' })
    const gap = run(leaving, tick)
    expect(gap).toMatchObject({ current: null, phase: 'empty', queue: ['b', 'c'], answered: null })
    expect(run(gap, tick)).toMatchObject({ current: 'b', phase: 'entering', queue: ['c'] })
  })

  it('draws the calm line a breath after the last one is answered', () => {
    const only = run(LIVE_START, data('a'), tick, tick)
    const gone = run(liveQueue(only, { type: 'answered', answer: 'Yes' }), data(), tick, tick)
    expect(gone).toMatchObject({ current: null, phase: 'empty', queue: [] })
    expect(run(gone, tick)).toMatchObject({ current: null, phase: 'calm', queue: [] })
  })
})

describe('a question that settles somewhere else', () => {
  it('leaves without an acknowledgement when the poll finds it gone', () => {
    const showing = run(LIVE_START, data('a', 'b'), tick, tick)
    const gone = liveQueue(showing, data('b'))
    expect(gone).toMatchObject({ current: 'a', phase: 'leaving', answered: null, queue: ['b'] })
  })

  it('does the same on the server saying it was already answered', () => {
    const showing = run(LIVE_START, data('a'), tick, tick)
    expect(liveQueue(showing, { type: 'stale' })).toMatchObject({ phase: 'leaving', answered: null })
  })

  it('is not disturbed a second time once it is already on its way out', () => {
    const leaving = run(LIVE_START, data('a', 'b'), tick, tick, data('b'))
    expect(liveQueue(leaving, data('b'))).toBe(leaving)
    expect(liveQueue(leaving, { type: 'stale' })).toBe(leaving)
  })
})

describe('an answer that does not land', () => {
  it('moves nothing, so the question is still there to try again', () => {
    const showing = run(LIVE_START, data('a'), tick, tick)
    expect(liveQueue(showing, { type: 'failed' })).toBe(showing)
  })
})

describe('a poll that changes nothing', () => {
  it('returns the same state, so the page does not repaint every five seconds', () => {
    const showing = run(LIVE_START, data('a', 'b'), tick, tick)
    expect(liveQueue(showing, data('a', 'b'))).toBe(showing)
  })

  it('drops a queued question that expired before it was ever shown', () => {
    const showing = run(LIVE_START, data('a', 'b', 'c'), tick, tick)
    expect(liveQueue(showing, data('a', 'c'))).toMatchObject({ current: 'a', queue: ['c'] })
  })

  it('appends what arrives, behind what was already waiting', () => {
    const showing = run(LIVE_START, data('a', 'b'), tick, tick)
    expect(liveQueue(showing, data('a', 'b', 'd'))).toMatchObject({ queue: ['b', 'd'] })
  })
})
