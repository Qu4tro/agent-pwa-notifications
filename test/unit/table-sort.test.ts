import { describe, expect, it } from 'vitest'
import { sortTableRows } from '../../src/lib/blocks'

// Note 8: a table block sorts on a header tap. The rules that are easy to get
// wrong are the ones an agent's own data runs into - measurements written with
// their units on, cells with nothing in them, and columns full of ties.

const order = (rows: { row: string[]; index: number }[]) => rows.map((r) => r.row[0])

describe('sortTableRows', () => {
  it('leaves the rows alone with no sort', () => {
    const rows = [['b'], ['a'], ['c']]
    expect(order(sortTableRows(rows, null))).toEqual(['b', 'a', 'c'])
  })

  it('sorts a column of measurements by their number, not their text', () => {
    const rows = [['100ms'], ['20ms'], ['3ms']]
    expect(order(sortTableRows(rows, { col: 0, dir: 'asc' }))).toEqual(['3ms', '20ms', '100ms'])
    expect(order(sortTableRows(rows, { col: 0, dir: 'desc' }))).toEqual(['100ms', '20ms', '3ms'])
  })

  it('reads percentages, decimals, signs and thousands separators', () => {
    const rows = [['92%'], ['-0.01'], ['1,024 req'], ['4.2 kB']]
    expect(order(sortTableRows(rows, { col: 0, dir: 'asc' }))).toEqual([
      '-0.01',
      '4.2 kB',
      '92%',
      '1,024 req',
    ])
  })

  it('sorts text with a locale compare that still counts digits', () => {
    const rows = [['/api/v1/item10'], ['/api/v1/item2'], ['/api/v1/item1']]
    expect(order(sortTableRows(rows, { col: 0, dir: 'asc' }))).toEqual([
      '/api/v1/item1',
      '/api/v1/item2',
      '/api/v1/item10',
    ])
  })

  it('puts empty cells last whichever way the column points', () => {
    const rows = [['b'], [''], ['a'], ['-'], ['n/a']]
    expect(order(sortTableRows(rows, { col: 0, dir: 'asc' }))).toEqual(['a', 'b', '', '-', 'n/a'])
    expect(order(sortTableRows(rows, { col: 0, dir: 'desc' }))).toEqual(['b', 'a', '', '-', 'n/a'])
  })

  it('is stable: tied rows keep the order the agent sent them in', () => {
    const rows = [
      ['first', 'x'],
      ['second', 'x'],
      ['third', 'x'],
    ]
    expect(order(sortTableRows(rows, { col: 1, dir: 'desc' }))).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('treats a missing cell as blank instead of throwing', () => {
    const rows = [['a'], ['b', 'z'], ['c', 'y']]
    expect(order(sortTableRows(rows, { col: 1, dir: 'asc' }))).toEqual(['c', 'b', 'a'])
  })
})
