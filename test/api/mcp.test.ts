import { describe, expect, it } from 'vitest'
import { call, createAccount, sessionFor } from '../helpers'

async function rpc(bearer: string, method: string, params?: unknown) {
  return call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method, params }, auth: { bearer } })
}

describe('the MCP endpoint', () => {
  it('needs a bearer key', async () => {
    const res = await call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } })
    expect(res.status).toBe(401)
  })

  it('reports the running version in serverInfo', async () => {
    const account = await createAccount('mcp-init@example.invalid')
    const res = await rpc(account.key, 'initialize')
    expect(res.status).toBe(200)
    expect(res.body.result.serverInfo).toEqual({
      name: 'agent-pwa-notifications',
      version: __APP_VERSION__,
    })
  })

  it('lists exactly the five real tools', async () => {
    const account = await createAccount('mcp-tools@example.invalid')
    const res = await rpc(account.key, 'tools/list')
    expect(res.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'ask',
      'clear',
      'notify',
      'update',
      'wait_for_answer',
    ])
  })

  it('describes no plan tiers and no hosted service', async () => {
    const account = await createAccount('mcp-wording@example.invalid')
    const res = await rpc(account.key, 'tools/list')
    const text = JSON.stringify(res.body.result.tools)
    expect(text).not.toMatch(/\bPro\b/)
    expect(text).not.toMatch(/\bFree\b/)
    expect(text).not.toContain('mycli.tools')
    expect(text).not.toContain('capabilities')
    expect(text).not.toContain('artifact')
  })

  it('creates an event through the notify tool', async () => {
    const account = await createAccount('mcp-notify@example.invalid')
    const res = await rpc(account.key, 'tools/call', {
      name: 'notify',
      arguments: { title: 'Build finished', project: 'demo' },
    })
    expect(res.status).toBe(200)
    const payload = JSON.parse(res.body.result.content[0].text)
    expect(payload).toMatchObject({ ok: true })
  })

  // Note 5: notify used to force kind:'update', so an MCP agent could never
  // finish a thread. Everything else about "done" rests on this passing.
  it('passes kind through the notify tool', async () => {
    const account = await createAccount('mcp-kind@example.invalid')
    const cookie = await sessionFor(account.id)
    await rpc(account.key, 'tools/call', {
      name: 'notify',
      arguments: { title: 'All finished', project: 'p', task_id: 'k', kind: 'done' },
    })
    const tasks = await call('GET', '/api/v1/tasks?project=p', { auth: { cookie } })
    expect(tasks.body.tasks[0].latest_kind).toBe('done')
  })

  it('refuses to create a question through the notify tool', async () => {
    const account = await createAccount('mcp-notify-question@example.invalid')
    const cookie = await sessionFor(account.id)
    await rpc(account.key, 'tools/call', {
      name: 'notify',
      arguments: { title: 'Not a question', project: 'q', task_id: 'k', kind: 'question' },
    })
    const tasks = await call('GET', '/api/v1/tasks?project=q', { auth: { cookie } })
    expect(tasks.body.tasks[0].latest_kind).toBe('update')
  })

  it('carries idle_minutes through the notify tool', async () => {
    const account = await createAccount('mcp-idle@example.invalid')
    const cookie = await sessionFor(account.id)
    await rpc(account.key, 'tools/call', {
      name: 'notify',
      arguments: { title: 'Going quiet', project: 'i', task_id: 'k', idle_minutes: 600 },
    })
    const tasks = await call('GET', '/api/v1/tasks?project=i', { auth: { cookie } })
    expect(tasks.body.tasks[0].idle_minutes).toBe(600)
  })
})
