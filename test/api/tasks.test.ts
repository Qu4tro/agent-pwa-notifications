import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor, type TestAccount } from '../helpers'

// The project list renders inline answer buttons for a micro-question, so
// GET /tasks has to carry the options. The rule for what counts as a micro
// question is the notification quick-answer rule, reused, so the buttons in
// the list and the buttons on the notification are never different.

async function ask(
  account: TestAccount,
  title: string,
  blocks: unknown[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await call('POST', '/api/v1/questions', {
    body: { agent: 'tester', title, project: 'p', blocks, ...extra },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

async function tasks(cookie: string) {
  const res = await call('GET', '/api/v1/tasks?project=p', { auth: { cookie } })
  expect(res.status).toBe(200)
  return res.body.tasks as {
    key: string
    pending: boolean
    pending_event_id: string | null
    pending_answers: { label: string; answer: Record<string, string> }[]
  }[]
}

describe('GET /api/v1/tasks pending_answers', () => {
  it('carries the options of a two-option micro-question', async () => {
    const account = await createAccount('micro2@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Ship it?', [
      { type: 'buttons', id: 'choice', options: ['Ship', 'Hold'] },
    ])

    const [task] = await tasks(cookie)
    expect(task.pending).toBe(true)
    expect(task.pending_event_id).toBe(id)
    expect(task.pending_answers).toEqual([
      { label: 'Ship', answer: { choice: 'Ship' } },
      { label: 'Hold', answer: { choice: 'Hold' } },
    ])
  })

  it('is empty for a question that is not a micro-question', async () => {
    const account = await createAccount('macro@example.invalid')
    const cookie = await sessionFor(account.id)
    await ask(account, 'Write the release note', [
      {
        type: 'form',
        id: 'notes',
        fields: [{ id: 'summary', kind: 'text', label: 'Summary' }],
      },
    ])

    const [task] = await tasks(cookie)
    expect(task.pending).toBe(true)
    expect(task.pending_answers).toEqual([])
  })

  it('is empty once the question is answered', async () => {
    const account = await createAccount('answered@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Ship it?', [
      { type: 'buttons', id: 'choice', options: ['Ship', 'Hold'] },
    ])

    const answered = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { choice: 'Ship' },
      auth: { cookie },
    })
    expect(answered.status).toBe(200)

    const [task] = await tasks(cookie)
    expect(task.pending).toBe(false)
    expect(task.pending_answers).toEqual([])
  })
})
