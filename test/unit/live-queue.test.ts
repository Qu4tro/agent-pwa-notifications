import { describe, expect, it } from 'vitest'
import { LIVE_START, liveQueue, type LiveState } from '../../src/routes/_app.pending_.live'

// The live mode's whole behaviour is this function. Everything below is the
// four inputs the page can hand it - a poll, a tap, a failure, a timer - and
// what should be on the screen after each one.

const run = (state: LiveState, ...inputs: Parameters<typeof liveQueue>[1][]) =>
  inputs.reduce(liveQueue, state)

// The page's own clock, as one step: the timer that ends whatever phase it is in.
const tick = { type: 'timer' } as const
const data = (...ids: string[]) => ({ type: 'data', ids }) as const

describe('an empty queue', () => {
  it('shows nothing and waits', () => {
    expect(run(LIVE_START, data(), tick)).toEqual(LIVE_START)
  })

  it('takes the first question a breath after it arrives, not the instant it lands', () => {
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

  it('draws the calm line once the last one is answered', () => {
    const only = run(LIVE_START, data('a'), tick, tick)
    const done = run(liveQueue(only, { type: 'answered', answer: 'Yes' }), data(), tick, tick)
    expect(done).toMatchObject({ current: null, phase: 'empty', queue: [] })
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
