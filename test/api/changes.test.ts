import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor, type TestAccount } from '../helpers'

const twoOptions = [{ type: 'buttons', id: 'choice', options: ['Yes', 'No'] }]

async function ask(account: TestAccount, taskId: string | null, title = 'Ship it?'): Promise<string> {
  const res = await call('POST', '/api/v1/questions', {
    body: { agent: 'tester', title, blocks: twoOptions, ...(taskId ? { task_id: taskId } : {}) },
    auth: { bearer: account.key },
  })
  expect(res.status).toBe(200)
  return res.body.id as string
}

async function answer(cookie: string, id: string, body: unknown) {
  const res = await call('POST', `/api/v1/questions/${id}/answer`, { body, auth: { cookie } })
  expect(res.status).toBe(200)
}

async function poll(account: TestAccount, id: string) {
  const res = await call('GET', `/api/v1/questions/${id}`, { auth: { bearer: account.key } })
  expect(res.status).toBe(200)
  return res.body
}

// Say the thing the whole feature exists for: an answer that stands is the
// latest one, and an agent that already read an older one has to be told.
async function askAndChange(account: TestAccount, cookie: string, taskId: string): Promise<string> {
  const id = await ask(account, taskId)
  await answer(cookie, id, { answer: { choice: 'Yes' } })
  await poll(account, id)
  await answer(cookie, id, { answer: { choice: 'No' }, text: 'on second thought' })
  return id
}

const notify = (account: TestAccount, taskId: string | null, title = 'Working') =>
  call('POST', '/api/v1/events', {
    body: { agent: 'tester', title, ...(taskId ? { task_id: taskId } : {}) },
    auth: { bearer: account.key },
  })

describe('the poll carries the whole document', () => {
  it('returns the words and the count of replacements', async () => {
    const account = await createAccount('changes-poll@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'c1')
    await answer(cookie, id, { answer: { choice: 'Yes' }, text: 'go now' })

    expect(await poll(account, id)).toMatchObject({
      status: 'answered',
      answer: { choice: 'Yes' },
      text: 'go now',
      changes: 0,
    })
  })
})

describe('changed_answers on the thread', () => {
  it('rides on the next notify and clears when the agent polls', async () => {
    const account = await createAccount('changes-notify@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await askAndChange(account, cookie, 'c2')

    const res = await notify(account, 'c2')
    expect(res.status).toBe(200)
    expect(res.body.changed_answers).toEqual([
      {
        id,
        title: 'Ship it?',
        answer: { choice: 'No' },
        text: 'on second thought',
        answered_at: expect.any(Number),
        changes: 1,
      },
    ])

    await poll(account, id)
    expect((await notify(account, 'c2')).body.changed_answers).toBeUndefined()
  })

  it('rides on the next ask on the thread', async () => {
    const account = await createAccount('changes-ask@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await askAndChange(account, cookie, 'c3')

    const res = await call('POST', '/api/v1/questions', {
      body: { agent: 'tester', title: 'And now?', blocks: twoOptions, task_id: 'c3' },
      auth: { bearer: account.key },
    })
    expect(res.status).toBe(200)
    expect(res.body.changed_answers.map((c: { id: string }) => c.id)).toEqual([id])
  })

  it('rides on the next update on the thread', async () => {
    const account = await createAccount('changes-update@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await askAndChange(account, cookie, 'c4')
    const eventId = (await notify(account, 'c4', 'Building')).body.id as string
    await poll(account, id)

    await answer(cookie, id, { answer: { choice: 'Yes' } })
    const res = await call('POST', `/api/v1/events/${eventId}`, {
      body: { title: 'Still building' },
      auth: { bearer: account.key },
    })
    expect(res.status).toBe(200)
    expect(res.body.changed_answers.map((c: { id: string }) => c.id)).toEqual([id])
  })

  it('stays on its own thread', async () => {
    const account = await createAccount('changes-other@example.invalid')
    const cookie = await sessionFor(account.id)
    await askAndChange(account, cookie, 'c5')

    expect((await notify(account, 'other')).body.changed_answers).toBeUndefined()
  })

  it('reaches no one on a call with no task_id', async () => {
    const account = await createAccount('changes-notask@example.invalid')
    const cookie = await sessionFor(account.id)
    await askAndChange(account, cookie, 'c6')

    expect((await notify(account, null)).body.changed_answers).toBeUndefined()
  })

  it('leaves a first answer alone', async () => {
    const account = await createAccount('changes-first@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'c7')
    await answer(cookie, id, { answer: { choice: 'Yes' } })

    expect((await notify(account, 'c7')).body.changed_answers).toBeUndefined()
  })

  it('carries a change the agent never polled a first answer for', async () => {
    const account = await createAccount('changes-unpolled@example.invalid')
    const cookie = await sessionFor(account.id)
    const id = await ask(account, 'c8')
    await answer(cookie, id, { answer: { choice: 'Yes' } })
    await answer(cookie, id, { text: 'words instead' })

    const res = await notify(account, 'c8')
    expect(res.body.changed_answers).toMatchObject([{ id, answer: {}, text: 'words instead', changes: 1 }])
  })

  it('carries an encrypted answer as the two ciphertexts', async () => {
    const account = await createAccount('changes-enc@example.invalid')
    const cookie = await sessionFor(account.id)
    const created = await call('POST', '/api/v1/questions', {
      body: { agent: 'tester', title: 'Encrypted?', enc: true, blocks: 'Y2lwaGVydGV4dA', task_id: 'c9' },
      auth: { bearer: account.key },
    })
    const id = created.body.id as string
    await answer(cookie, id, { enc: true, answer: 'QUFB' })
    await answer(cookie, id, { enc: true, answer: 'QkJC', text: 'Q0ND' })

    const res = await notify(account, 'c9')
    expect(res.body.changed_answers).toMatchObject([{ id, answer: 'QkJC', text: 'Q0ND' }])
  })
})

describe('the MCP tools say what a change is', () => {
  it('puts changed_answers in the notify result', async () => {
    const account = await createAccount('changes-mcp@example.invalid')
    const cookie = await sessionFor(account.id)
    await askAndChange(account, cookie, 'c10')

    const res = await call('POST', '/mcp', {
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'notify', arguments: { title: 'Working', task_id: 'c10' } },
      },
      auth: { bearer: account.key },
    })
    expect(res.status).toBe(200)
    expect(res.body.result.content[0].text).toContain('changed_answers')
  })
})
