import { describe, expect, it } from 'vitest'
import {
  quickAnswerActions,
  previewText,
  type QuickAnswerEvent,
} from '../../src/server/quick-answers'
import type { Block } from '../../src/server/blocks'

function question(blocks: Block[], over: Partial<QuickAnswerEvent> = {}): QuickAnswerEvent {
  return {
    kind: 'question',
    enc: 0,
    title: 'Ship it?',
    blocks: JSON.stringify(blocks),
    ...over,
  }
}

const twoOptions: Block[] = [{ type: 'buttons', id: 'choice', options: ['Yes', 'No'] }]

describe('quickAnswerActions', () => {
  it('turns a two-option buttons block into two actions', () => {
    expect(quickAnswerActions(question(twoOptions))).toEqual([
      { action: 'answer-0', title: 'Yes', answer: { choice: 'Yes' } },
      { action: 'answer-1', title: 'No', answer: { choice: 'No' } },
    ])
  })

  it('accepts three options', () => {
    const blocks: Block[] = [{ type: 'buttons', id: 'c', options: ['A', 'B', 'C'] }]
    expect(quickAnswerActions(question(blocks)).map((a) => a.title)).toEqual(['A', 'B', 'C'])
  })

  it('rejects one option and four options', () => {
    const one: Block[] = [{ type: 'buttons', id: 'c', options: ['Only'] }]
    const four: Block[] = [{ type: 'buttons', id: 'c', options: ['A', 'B', 'C', 'D'] }]
    expect(quickAnswerActions(question(one))).toEqual([])
    expect(quickAnswerActions(question(four))).toEqual([])
  })

  it('rejects a title longer than 80 characters', () => {
    expect(quickAnswerActions(question(twoOptions, { title: 'x'.repeat(80) }))).toHaveLength(2)
    expect(quickAnswerActions(question(twoOptions, { title: 'x'.repeat(81) }))).toEqual([])
  })

  it('rejects an option longer than 20 characters', () => {
    const ok: Block[] = [{ type: 'buttons', id: 'c', options: ['x'.repeat(20), 'No'] }]
    const tooLong: Block[] = [{ type: 'buttons', id: 'c', options: ['x'.repeat(21), 'No'] }]
    expect(quickAnswerActions(question(ok))).toHaveLength(2)
    expect(quickAnswerActions(question(tooLong))).toEqual([])
  })

  it('rejects an untrimmed option', () => {
    const blocks: Block[] = [{ type: 'buttons', id: 'c', options: [' Yes', 'No'] }]
    expect(quickAnswerActions(question(blocks))).toEqual([])
  })

  it('needs exactly one interactive block', () => {
    const none: Block[] = [{ type: 'markdown', text: 'no buttons here' }]
    const two: Block[] = [
      { type: 'buttons', id: 'a', options: ['Yes', 'No'] },
      { type: 'buttons', id: 'b', options: ['Up', 'Down'] },
    ]
    const withForm: Block[] = [
      { type: 'buttons', id: 'a', options: ['Yes', 'No'] },
      { type: 'form', id: 'f', fields: [{ id: 'why', kind: 'text', label: 'Why' }] },
    ]
    expect(quickAnswerActions(question(none))).toEqual([])
    expect(quickAnswerActions(question(two))).toEqual([])
    expect(quickAnswerActions(question(withForm))).toEqual([])
  })

  it('ignores display blocks alongside the buttons block', () => {
    const blocks: Block[] = [
      { type: 'markdown', text: 'Ready to deploy.' },
      { type: 'buttons', id: 'choice', options: ['Yes', 'No'] },
    ]
    expect(quickAnswerActions(question(blocks))).toHaveLength(2)
  })

  it('skips encrypted questions', () => {
    expect(quickAnswerActions(question(twoOptions, { enc: 1 }))).toEqual([])
  })

  it('skips events that are not questions', () => {
    expect(quickAnswerActions(question(twoOptions, { kind: 'update' }))).toEqual([])
  })

  it('returns nothing for unparseable blocks', () => {
    expect(quickAnswerActions(question(twoOptions, { blocks: 'not json' }))).toEqual([])
  })
})

describe('previewText', () => {
  it('strips markdown punctuation and caps at 140 characters', () => {
    expect(previewText([{ type: 'markdown', text: '# Done `ok`' }])).toBe(' Done ok')
    expect(previewText([{ type: 'markdown', text: 'a'.repeat(200) }])).toHaveLength(140)
  })

  it('uses a callout and a keyvalue pair', () => {
    expect(previewText([{ type: 'callout', tone: 'info', text: 'Heads up' }])).toBe('Heads up')
    expect(previewText([{ type: 'keyvalue', items: [{ k: 'Tests', v: '42 passed' }] }])).toBe(
      'Tests: 42 passed',
    )
  })

  it('falls back when no block carries text', () => {
    expect(previewText([{ type: 'buttons', id: 'c', options: ['Yes', 'No'] }])).toMatch(/details/)
    expect(previewText([])).toMatch(/details/)
  })
})
