import { describe, expect, it } from 'vitest'
import { questionStanding } from '../../src/lib/question'
import type { QuestionState } from '../../src/lib/api'

// Note 2: a shut row says where its question stands with a dot and one word.
// Three of the five states are `answered` and share one colour, so the word is
// the only thing that tells them apart - and the label under it is what a
// screen reader is given instead of the colour.

function question(over: Partial<QuestionState> = {}): QuestionState {
  return {
    status: 'answered',
    answer: { pick: 'Ship' },
    text: null,
    answered_at: 1_700_000_000_000,
    timeout_at: 1_700_003_600_000,
    picked_up_at: null,
    changes: 0,
    ...over,
  }
}

describe('questionStanding', () => {
  it('waits on you while it is pending', () => {
    const s = questionStanding(question({ status: 'pending', answer: null, answered_at: null }))
    expect(s).toEqual({
      tone: 'pending',
      word: 'waiting',
      label: 'Waiting for your answer.',
    })
  })

  it('waits on the agent once it is answered', () => {
    expect(questionStanding(question())).toEqual({
      tone: 'answered',
      word: 'sent',
      label: 'Answered. Waiting for the agent.',
    })
  })

  it('waits on the agent again after a change', () => {
    expect(questionStanding(question({ changes: 1 }))).toEqual({
      tone: 'answered',
      word: 'changed',
      label: 'Changed. Waiting for the agent.',
    })
  })

  it('is received once the agent has collected it', () => {
    expect(questionStanding(question({ picked_up_at: 1_700_000_100_000 }))).toEqual({
      tone: 'answered',
      word: 'received',
      label: 'Agent received it.',
    })
  })

  it('says which of the two the agent received when there was a change', () => {
    const s = questionStanding(question({ picked_up_at: 1_700_000_100_000, changes: 2 }))
    expect(s.label).toBe('Agent received the change.')
  })

  it('is muted once it has expired', () => {
    const s = questionStanding(question({ status: 'expired', answer: null, answered_at: null }))
    expect(s).toEqual({ tone: 'expired', word: 'expired', label: 'Expired before you answered.' })
  })

  // Expiry is written on the question whatever else is on it, so an answer
  // that arrived too late is not read as having got through.
  it('expired wins over an answer that is still on the question', () => {
    expect(questionStanding(question({ status: 'expired', changes: 1 })).tone).toBe('expired')
  })
})
