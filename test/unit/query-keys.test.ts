import { describe, expect, it } from 'vitest'
import { partialMatchKey } from '@tanstack/react-query'
import { LIVE_KEYS, queryKeys } from '../../src/lib/queries'

describe('queryKeys', () => {
  it('gives each resource its own key', () => {
    const keys = [
      queryKeys.config(),
      queryKeys.account(),
      queryKeys.projects(),
      queryKeys.pending(),
      queryKeys.settings(),
    ].map((k) => JSON.stringify(k))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('puts the parameters in the key, so two projects do not share a cache entry', () => {
    expect(queryKeys.tasks('herdr')).toEqual(['tasks', 'herdr'])
    expect(queryKeys.tasks('herdr')).not.toEqual(queryKeys.tasks('recall'))
    expect(queryKeys.thread('herdr', 'k1')).toEqual(['thread', 'herdr', 'k1'])
    expect(queryKeys.thread('herdr', 'k1')).not.toEqual(queryKeys.thread('herdr', 'k2'))
  })

  it('keeps the "no project" bucket apart from a project named like it', () => {
    expect(queryKeys.tasks('')).toEqual(['tasks', ''])
    expect(queryKeys.tasks('')).not.toEqual(queryKeys.tasks('__none__'))
  })

  it('builds the same key for the same arguments', () => {
    expect(queryKeys.thread('p', 'k')).toEqual(queryKeys.thread('p', 'k'))
  })
})

describe('LIVE_KEYS', () => {
  // setQueryDefaults and invalidateQueries both match on a key prefix, so the
  // poll interval and every invalidation only reach the lists if these stay
  // prefixes of the real keys.
  it('is a prefix of every list key it has to reach', () => {
    const covered = (key: readonly unknown[]) =>
      LIVE_KEYS.some((live) => partialMatchKey(key, live))
    expect(covered(queryKeys.projects())).toBe(true)
    expect(covered(queryKeys.tasks('herdr'))).toBe(true)
    expect(covered(queryKeys.thread('herdr', 'k1'))).toBe(true)
    // The header badge and the pending page read this one, so it has to poll
    // and be invalidated with the lists it is derived from.
    expect(covered(queryKeys.pending())).toBe(true)
  })

  it('leaves the queries that must not poll alone', () => {
    const covered = (key: readonly unknown[]) =>
      LIVE_KEYS.some((live) => partialMatchKey(key, live))
    expect(covered(queryKeys.config())).toBe(false)
    expect(covered(queryKeys.account())).toBe(false)
    expect(covered(queryKeys.settings())).toBe(false)
    expect(covered(queryKeys.event('01H'))).toBe(false)
  })
})
