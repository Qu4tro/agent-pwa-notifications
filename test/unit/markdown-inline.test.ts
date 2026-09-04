import { describe, expect, it } from 'vitest'
import { splitInline } from '../../src/lib/blocks'

// Note 6: an agent writes a URL the way it would in a terminal, bare, and the
// renderer used to leave it as words. The hard part is not finding the URL, it
// is knowing where it stops: a URL runs to the first space, so the sentence
// around it comes along unless it is handed back.

const links = (text: string) =>
  splitInline(text)
    .filter((t) => t.kind === 'link')
    .map((t) => (t.kind === 'link' ? t.url : ''))

const plain = (text: string) =>
  splitInline(text)
    .filter((t) => t.kind === 'text')
    .map((t) => (t.kind === 'text' ? t.text : ''))

describe('splitInline', () => {
  it('leaves prose with nothing in it as one run of text', () => {
    expect(splitInline('Nothing to see here.')).toEqual([
      { kind: 'text', text: 'Nothing to see here.' },
    ])
  })

  it('turns a bare http and a bare https URL into a link labelled with itself', () => {
    expect(splitInline('go to https://example.com now')).toEqual([
      { kind: 'text', text: 'go to ' },
      { kind: 'link', label: 'https://example.com', url: 'https://example.com' },
      { kind: 'text', text: ' now' },
    ])
    expect(links('http://localhost:3000/icon.png')).toEqual(['http://localhost:3000/icon.png'])
  })

  it('still reads [label](url), and does not link the URL inside it twice', () => {
    expect(splitInline('see [the PR](https://github.com/o/r/pull/8) today')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', label: 'the PR', url: 'https://github.com/o/r/pull/8' },
      { kind: 'text', text: ' today' },
    ])
  })

  it('leaves a URL inside a code span alone', () => {
    expect(splitInline('run `curl https://example.com` first')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'curl https://example.com' },
      { kind: 'text', text: ' first' },
    ])
  })

  it('keeps bold and code working next to a bare URL', () => {
    expect(splitInline('**ship** `now` https://example.com')).toEqual([
      { kind: 'bold', text: 'ship' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'now' },
      { kind: 'text', text: ' ' },
      { kind: 'link', label: 'https://example.com', url: 'https://example.com' },
    ])
  })

  it('leaves the punctuation that ends the sentence outside the link', () => {
    for (const end of ['.', ',', ';', ':', '!', '?']) {
      expect(links(`at https://example.com/a${end}`)).toEqual(['https://example.com/a'])
      expect(plain(`at https://example.com/a${end}`)).toEqual(['at ', end])
    }
  })

  it('strips a run of trailing punctuation, not just the last one', () => {
    expect(links('really https://example.com/a?!')).toEqual(['https://example.com/a'])
  })

  it('drops a closing bracket the URL never opened', () => {
    expect(links('(see https://example.com/a)')).toEqual(['https://example.com/a'])
    expect(links('[https://example.com/a]')).toEqual(['https://example.com/a'])
    expect(links('{https://example.com/a}')).toEqual(['https://example.com/a'])
  })

  it('keeps a closing bracket the URL did open', () => {
    expect(links('read https://en.wikipedia.org/wiki/Latte_(coffee)')).toEqual([
      'https://en.wikipedia.org/wiki/Latte_(coffee)',
    ])
    expect(links('read https://en.wikipedia.org/wiki/Latte_(coffee).')).toEqual([
      'https://en.wikipedia.org/wiki/Latte_(coffee)',
    ])
    expect(links('(read https://en.wikipedia.org/wiki/Latte_(coffee))')).toEqual([
      'https://en.wikipedia.org/wiki/Latte_(coffee)',
    ])
  })

  it('stops a URL at a space', () => {
    expect(links('https://example.com/a b/c')).toEqual(['https://example.com/a'])
  })

  it('takes several URLs in one line', () => {
    expect(links('https://a.example, https://b.example and https://c.example.')).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ])
  })

  it('links nothing for a scheme it does not know', () => {
    expect(links('javascript:alert(1) and ftp://example.com and www.example.com')).toEqual([])
  })

  it('returns nothing for empty text', () => {
    expect(splitInline('')).toEqual([])
  })
})
