import { describe, expect, it } from 'vitest'
import { splitFences } from '../../src/lib/blocks'

// An agent told to send a `markdown` block writes fenced code into it. The
// fence used to arrive as a paragraph of literal backticks, with the code
// under it as prose - no monospace, no highlighting, no copy button, and
// nothing in the API response to tell the agent it had happened. These are the
// shapes real agent messages come in.

describe('splitFences', () => {
  it('leaves prose with no fence in it as one segment', () => {
    expect(splitFences('# Title\n\nA line, and `inline code` in it.')).toEqual([
      { kind: 'text', text: '# Title\n\nA line, and `inline code` in it.' },
    ])
  })

  it('pulls a fence out with its language', () => {
    const segments = splitFences('Run this:\n\n```bash\nnpm test\n```\n\nThen deploy.')
    expect(segments).toEqual([
      { kind: 'text', text: 'Run this:\n' },
      { kind: 'code', lang: 'bash', text: 'npm test' },
      { kind: 'text', text: '\nThen deploy.' },
    ])
  })

  it('carries a fence with no language as a code segment anyway', () => {
    expect(splitFences('```\nplain\n```')).toEqual([{ kind: 'code', lang: undefined, text: 'plain' }])
  })

  it('keeps only the first word of the info string as the language', () => {
    expect(splitFences('```js title="app.js"\nx\n```')[0]).toMatchObject({ kind: 'code', lang: 'js' })
  })

  it('keeps blank lines and indentation inside the block verbatim', () => {
    const [block] = splitFences('```py\ndef f():\n\n    return 1\n```')
    expect(block).toEqual({ kind: 'code', lang: 'py', text: 'def f():\n\n    return 1' })
  })

  it('runs an unclosed fence to the end rather than dropping the code', () => {
    expect(splitFences('Here:\n```sh\ncurl https://example.com\n')).toEqual([
      { kind: 'text', text: 'Here:' },
      { kind: 'code', lang: 'sh', text: 'curl https://example.com\n' },
    ])
  })

  it('closes on a run at least as long as the opener, so a block can quote a fence', () => {
    const [block] = splitFences('````md\n```js\nx\n```\n````')
    expect(block).toEqual({ kind: 'code', lang: 'md', text: '```js\nx\n```' })
  })

  it('takes several fences in one message', () => {
    const segments = splitFences('```a\n1\n```\ntext\n```b\n2\n```')
    expect(segments.map((s) => s.kind)).toEqual(['code', 'text', 'code'])
  })

  it('is not fooled by inline code with backticks in it', () => {
    expect(splitFences('``a``b``')).toEqual([{ kind: 'text', text: '``a``b``' }])
  })

  it('allows up to three spaces of indent on the fence', () => {
    expect(splitFences('   ```\nx\n   ```')).toEqual([{ kind: 'code', lang: undefined, text: 'x' }])
  })

  it('drops a blank-only run between fences instead of rendering an empty paragraph', () => {
    expect(splitFences('```\na\n```\n\n```\nb\n```').map((s) => s.kind)).toEqual(['code', 'code'])
  })

  it('returns nothing for an empty block', () => {
    expect(splitFences('')).toEqual([])
  })
})
