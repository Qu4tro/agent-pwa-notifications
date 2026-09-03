// The syntax highlighter, in its own module so it lands in its own chunk. It
// is imported with a dynamic import() and only from a thread that actually has
// a code block in it, so a phone opening a list of updates never pays for it.
//
// refractor is Prism with a hast tree instead of an HTML string, which is the
// whole reason it is here: agent content is never handed to
// dangerouslySetInnerHTML, and a highlighter that only speaks HTML would have
// forced that. The tree is walked into React elements below.

import { createElement, type ReactNode } from 'react'
import { refractor } from 'refractor/core'
import bash from 'refractor/bash'
import css from 'refractor/css'
import diff from 'refractor/diff'
import go from 'refractor/go'
import json from 'refractor/json'
import markup from 'refractor/markup'
import python from 'refractor/python'
import rust from 'refractor/rust'
import sql from 'refractor/sql'
import tsx from 'refractor/tsx'
import typescript from 'refractor/typescript'
import yaml from 'refractor/yaml'
import type { RootContent } from 'hast'

// Thirteen grammars, which is what agents write in. Each one pulls in whatever
// it is built on (tsx brings jsx, javascript and markup), so the list is
// shorter than the chunk.
for (const syntax of [markup, css, typescript, tsx, json, bash, python, rust, go, sql, yaml, diff])
  refractor.register(syntax)

// What an agent writes in a fence, mapped to what Prism calls it. Anything not
// here and not a registered name is left as plain text - a wrong guess colours
// the wrong words, which is worse than no colour.
const ALIAS: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  jsonc: 'json',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  yml: 'yaml',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  patch: 'diff',
}

function toReact(node: RootContent, key: string): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null
  const classes = node.properties?.className
  return createElement(
    'span',
    { key, className: Array.isArray(classes) ? classes.join(' ') : undefined },
    node.children.map((child, i) => toReact(child, `${key}-${i}`)),
  )
}

// Null means "leave the plain block alone": an unknown language, or a grammar
// that threw on input it did not expect.
export function highlightToNodes(code: string, lang: string): ReactNode | null {
  const name = ALIAS[lang.toLowerCase()] ?? lang.toLowerCase()
  if (!refractor.registered(name)) return null
  try {
    return refractor.highlight(code, name).children.map((child, i) => toReact(child, String(i)))
  } catch {
    return null
  }
}
