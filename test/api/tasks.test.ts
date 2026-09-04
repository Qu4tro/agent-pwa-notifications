import { env } from 'cloudflare:workers'
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

async function tasks(cookie: string, project = 'p') {
  const res = await call('GET', `/api/v1/tasks?project=${project}`, { auth: { cookie } })
  expect(res.status).toBe(200)
  return res.body.tasks as {
    key: string
    pending: boolean
    pending_event_id: string | null
    pending_answers: { label: string; answer: Record<string, string> }[]
    state: 'pending' | 'active' | 'done'
    unread: number
    idle_minutes: number | null
    latest_kind: string
    count: number
    recent: {
      id: string
      kind: string
      title: string
      read_at: number | null
      question: { status: string; answer: unknown } | null
    }[]
  }[]
}

// One update on its own thread, in its own project, so each case in the state
// suite is isolated from the others.
async function notify(
  account: TestAccount,
  project: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await call('POST', '/api/v1/events', {
    body: { agent: 'tester', title: 'Working', project, task_id: 'thread', ...body },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

// The clock cannot be moved, so the row is: an event that happened long enough
// ago that its idle timeout has run out.
async function backdate(id: string, minutesAgo: number) {
  const t = Date.now() - minutesAgo * 60_000
  await env.DB.prepare('UPDATE events SET created_at = ?1, updated_at = ?1 WHERE id = ?2')
    .bind(t, id)
    .run()
}

async function markRead(id: string, cookie: string) {
  const res = await call('POST', `/api/v1/event/${id}/read`, { auth: { cookie } })
  expect(res.status).toBe(200)
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

// Note 5: which section of the project page a thread lands in is a fact about
// the agent - what it last said, and how long it has been quiet - not about
// what the human has read.
describe('GET /api/v1/tasks thread state', () => {
  it('is active while the agent is working and everything has been read', async () => {
    const account = await createAccount('state-active@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, 'active')
    await markRead(id, cookie)

    const [task] = await tasks(cookie, 'active')
    expect(task.unread).toBe(0)
    expect(task.state).toBe('active')
  })

  it('is done once the agent sends kind done and the human has seen it', async () => {
    const account = await createAccount('state-done@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, 'done', { title: 'Shipped', kind: 'done' })
    await markRead(id, cookie)

    const [task] = await tasks(cookie, 'done')
    expect(task.state).toBe('done')
  })

  it('keeps a finished thread out of done while something in it is unread', async () => {
    const account = await createAccount('state-done-unread@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, 'unseen', { title: 'Shipped', kind: 'done' })

    const [task] = await tasks(cookie, 'unseen')
    expect(task.unread).toBe(1)
    expect(task.state).toBe('active')
  })

  it('does not treat an error as the end of a thread', async () => {
    const account = await createAccount('state-error@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, 'err', { title: 'Build failed', kind: 'error' })
    await markRead(id, cookie)

    const [task] = await tasks(cookie, 'err')
    expect(task.latest_kind).toBe('error')
    expect(task.state).toBe('active')
  })

  it('finishes a thread that has been quiet past the four hour default', async () => {
    const account = await createAccount('state-idle-default@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, 'quiet')
    await markRead(id, cookie)
    await backdate(id, 241)

    const [task] = await tasks(cookie, 'quiet')
    expect(task.idle_minutes).toBe(null)
    expect(task.state).toBe('done')
  })

  it('honours the idle_minutes the agent set, in both directions', async () => {
    const account = await createAccount('state-idle-set@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await notify(account, 'long', { idle_minutes: 720 })
    await markRead(id, cookie)
    await backdate(id, 300) // past the 240 default, inside the 720 it asked for

    const [task] = await tasks(cookie, 'long')
    expect(task.idle_minutes).toBe(720)
    expect(task.state).toBe('active')

    await backdate(id, 721)
    const [after] = await tasks(cookie, 'long')
    expect(after.state).toBe('done')
  })

  it('takes the latest idle_minutes on the thread', async () => {
    const account = await createAccount('state-idle-latest@example.invalid')
    const cookie = await sessionFor(account.id)
    const first = await notify(account, 'latest', { idle_minutes: 720 })
    const second = await notify(account, 'latest', { title: 'Nearly there', idle_minutes: 30 })
    await markRead(first, cookie)
    await markRead(second, cookie)
    await backdate(first, 400)
    await backdate(second, 60)

    const [task] = await tasks(cookie, 'latest')
    expect(task.idle_minutes).toBe(30)
    expect(task.state).toBe('done')
  })

  it('clamps idle_minutes to a minute and to seven days', async () => {
    const account = await createAccount('state-idle-bounds@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, 'low', { idle_minutes: 0 })
    await notify(account, 'high', { idle_minutes: 99999 })

    expect((await tasks(cookie, 'low'))[0].idle_minutes).toBe(1)
    expect((await tasks(cookie, 'high'))[0].idle_minutes).toBe(10080)
  })

  it('is pending whenever a question is waiting, however long it has been quiet', async () => {
    const account = await createAccount('state-pending@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Ship it?', [
      { type: 'buttons', id: 'choice', options: ['Ship', 'Hold'] },
    ])
    await backdate(id, 5000)

    const [task] = await tasks(cookie)
    expect(task.state).toBe('pending')
  })
})

// Note 3: the row used to show the newest title and a count, so a thread of
// three events said "3" where it could have said what the three were.
describe('GET /api/v1/tasks recent', () => {
  it('carries the events oldest first', async () => {
    const account = await createAccount('recent-order@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, 'r1', { title: 'First' })
    await notify(account, 'r1', { title: 'Second' })
    await notify(account, 'r1', { title: 'Third' })

    const [task] = await tasks(cookie, 'r1')
    expect(task.recent.map((r) => r.title)).toEqual(['First', 'Second', 'Third'])
    expect(task.count).toBe(3)
  })

  it('caps at three and keeps the newest three', async () => {
    const account = await createAccount('recent-cap@example.invalid')
    const cookie = await sessionFor(account.id)
    for (const title of ['One', 'Two', 'Three', 'Four', 'Five'])
      await notify(account, 'r2', { title })

    const [task] = await tasks(cookie, 'r2')
    expect(task.count).toBe(5)
    expect(task.recent.map((r) => r.title)).toEqual(['Three', 'Four', 'Five'])
  })

  it('carries the kind and the read state of each one', async () => {
    const account = await createAccount('recent-meta@example.invalid')
    const cookie = await sessionFor(account.id)
    const first = await notify(account, 'r3', { title: 'Started' })
    await notify(account, 'r3', { title: 'Broke', kind: 'error' })
    await markRead(first, cookie)

    const [task] = await tasks(cookie, 'r3')
    expect(task.recent.map((r) => r.kind)).toEqual(['update', 'error'])
    expect(task.recent[0].read_at).not.toBe(null)
    expect(task.recent[1].read_at).toBe(null)
  })

  // Note 5: the row showed "Question Roll the flag to production today?" and
  // nothing about what was decided, though the SELECT behind it already reads
  // the question's status and answer.
  it('carries what a settled question was answered with', async () => {
    const account = await createAccount('recent-answer@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Roll it?', [
      { type: 'buttons', id: 'roll', options: ['Yes', 'No'] },
    ])
    const answered = await call('POST', `/api/v1/questions/${id}/answer`, {
      body: { roll: 'Yes' },
      auth: { cookie },
    })
    expect(answered.status).toBe(200)

    const [task] = await tasks(cookie)
    const entry = task.recent.find((r) => r.id === id)
    expect(entry?.question).toEqual({ status: 'answered', answer: { roll: 'Yes' } })
  })

  it('says a question is still pending, and carries no answer for it', async () => {
    const account = await createAccount('recent-pending@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'Roll it?', [
      { type: 'buttons', id: 'roll', options: ['Yes', 'No'] },
    ])

    const [task] = await tasks(cookie)
    const entry = task.recent.find((r) => r.id === id)
    expect(entry?.question).toEqual({ status: 'pending', answer: null })
  })

  it('leaves an event that is not a question with no question at all', async () => {
    const account = await createAccount('recent-noq@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, 'r5', { title: 'Just an update' })

    const [task] = await tasks(cookie, 'r5')
    expect(task.recent[0].question).toBe(null)
  })

  it('has one entry for a thread of one event', async () => {
    const account = await createAccount('recent-single@example.invalid')
    const cookie = await sessionFor(account.id)
    await notify(account, 'r4', { title: 'Only' })

    const [task] = await tasks(cookie, 'r4')
    expect(task.recent).toHaveLength(1)
    expect(task.recent[0].title).toBe('Only')
  })
})
