import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  ExternalLink,
  Info,
  SendHorizontal,
  TriangleAlert,
} from 'lucide-react'
import { answerStyles } from './answers'
import type { AnswerDoc } from './api'
import { CodeBlock } from './highlight'
import { Button, IconButton, fieldClass } from './ui'

// -- Minimal, XSS-safe markdown to React -------------------------------------
// We never dangerouslySetInnerHTML agent content. Text is escaped by React by
// default; here we only turn a small, known set of markdown into real elements.
function inline(text: string, key: string): React.ReactNode[] {
  // Split on **bold**, `code`, and [label](url); everything else is plain text.
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) parts.push(<strong key={`${key}-${i}`}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) parts.push(<code key={`${key}-${i}`}>{tok.slice(1, -1)}</code>)
    else {
      const lm = tok.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/)
      if (lm)
        parts.push(
          <a key={`${key}-${i}`} href={lm[2]} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>,
        )
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// -- Fenced code inside a markdown block --------------------------------------
// A coding agent told to send `markdown` writes fenced code into it, because
// that is what writing markdown means. Until now the fence came through as a
// paragraph of literal backticks and the code as prose. A fence is the same
// thing a `code` block is, so it renders as one - same highlighting, same copy
// button - and the prose around it stays markdown.
export type MdSegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang?: string; text: string }

// Up to three spaces of indent and three or more backticks, then an info
// string with no backtick in it. CommonMark's rule, and the reason for the
// last part: `` ```a``b `` is inline code, not a fence.
const FENCE_OPEN = /^ {0,3}(`{3,})[ \t]*([^`\n]*?)[ \t]*$/

// Exported for its own test: the edge cases here - the info string, an
// unclosed fence, a fence that is only part of the message - are what decides
// whether an agent's code survives the trip.
export function splitFences(text: string): MdSegment[] {
  const segments: MdSegment[] = []
  const lines = text.split('\n')
  let prose: string[] = []

  // Blank runs between fences are separation, not a paragraph: dropping them
  // keeps the flex gap from doubling around every block.
  const flushProse = () => {
    if (prose.some((l) => l.trim() !== '')) segments.push({ kind: 'text', text: prose.join('\n') })
    prose = []
  }

  let i = 0
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i])
    if (!open) {
      prose.push(lines[i])
      i++
      continue
    }
    flushProse()
    // A fence closes on a run of backticks at least as long as the one that
    // opened it, so a block can quote a shorter fence.
    const close = new RegExp(`^ {0,3}\`{${open[1].length},}[ \t]*$`)
    // The first word of the info string is the language; the rest is metadata
    // no highlighter here reads. Capped like the `code` block's own `lang`.
    const lang = open[2].split(/\s+/)[0].slice(0, 40) || undefined
    const body: string[] = []
    i++
    while (i < lines.length && !close.test(lines[i])) {
      body.push(lines[i])
      i++
    }
    i++ // step over the closing fence, or past the end if there wasn't one
    // An unclosed fence runs to the end of the message rather than losing the
    // code under it - the call CommonMark makes, and the safer one here.
    segments.push({ kind: 'code', lang, text: body.join('\n') })
  }
  flushProse()
  return segments
}

function MiniMarkdown({ text }: { text: string }) {
  const segments = useMemo(() => splitFences(text), [text])
  if (segments.length === 0) return null
  // The common case is prose with no fence in it, and it renders exactly as it
  // did: one .md element, no wrapper around it.
  if (segments.length === 1 && segments[0].kind === 'text') return <Prose text={segments[0].text} />
  return (
    <div className="flex flex-col gap-3">
      {segments.map((s, i) =>
        s.kind === 'code' ? (
          <CodeBlock key={i} text={s.text} lang={s.lang} />
        ) : (
          <Prose key={i} text={s.text} />
        ),
      )}
    </div>
  )
}

function Prose({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let list: string[] = []
  const flush = (k: string) => {
    if (list.length) {
      out.push(
        <ul key={`ul-${k}`}>
          {list.map((li, i) => (
            <li key={i}>{inline(li, `${k}-${i}`)}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }
  lines.forEach((line, idx) => {
    const k = String(idx)
    if (/^###\s+/.test(line)) {
      flush(k)
      out.push(<h3 key={k}>{inline(line.replace(/^###\s+/, ''), k)}</h3>)
    } else if (/^##\s+/.test(line)) {
      flush(k)
      out.push(<h2 key={k}>{inline(line.replace(/^##\s+/, ''), k)}</h2>)
    } else if (/^#\s+/.test(line)) {
      flush(k)
      out.push(<h1 key={k}>{inline(line.replace(/^#\s+/, ''), k)}</h1>)
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''))
    } else if (line.trim() === '') {
      flush(k)
    } else {
      flush(k)
      out.push(<p key={k}>{inline(line, k)}</p>)
    }
  })
  flush('end')
  return <div className="md">{out}</div>
}

// -- Display blocks ----------------------------------------------------------
type AnyBlock = Record<string, unknown> & { type: string }

// A callout's tone is the agent's word for what it is saying. Three of them
// are kind colours; warn is its own token.
//
// Four tones one under another, told apart by a 3px rail and nothing else, is
// colour carrying the whole message (WCAG 1.4.1). So each tone gets an icon as
// well, and the block reads as a chip - a tinted surface with an edge - which
// is also what stops a callout from disappearing into the paragraph above it.
//
// Every class is written out in full, because Tailwind reads the source.
const TONE = {
  info: {
    className: 'border-kind-update/40 bg-kind-update/10 text-kind-update',
    Icon: Info,
    label: 'Info',
  },
  success: {
    className: 'border-kind-done/40 bg-kind-done/10 text-kind-done',
    Icon: CircleCheck,
    label: 'Success',
  },
  warn: {
    className: 'border-warn/40 bg-warn/10 text-warn',
    Icon: TriangleAlert,
    label: 'Warning',
  },
  error: {
    className: 'border-kind-error/40 bg-kind-error/10 text-kind-error',
    Icon: CircleX,
    label: 'Error',
  },
} as const

export type Tone = keyof typeof TONE

// The tone colours the chip and the icon; the words stay --color-text, so the
// contrast of the message itself never depends on which tone it is.
export function Callout({ tone = 'info', children }: { tone?: string; children: React.ReactNode }) {
  const t = TONE[tone as Tone] ?? TONE.info
  return (
    <div className={`flex items-start gap-2 rounded-ui border px-3 py-2 ${t.className}`}>
      <t.Icon size={18} className="mt-[3px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-text">
        <span className="sr-only">{t.label}: </span>
        {children}
      </div>
    </div>
  )
}

// -- Sortable table ----------------------------------------------------------
// Sorting a table an agent sent is a reading aid, not an edit: the third tap on
// a column puts the rows back in the order they arrived, and nothing is
// remembered once the thread is closed. State is per block, so two tables in
// one message sort independently.

type Sort = { col: number; dir: 'asc' | 'desc' } | null

// "18ms", "4.2 kB", "92%", "-0.01" and "1,024" all sort as numbers: agents
// write measurements with their units attached, and a column of them sorted as
// text puts 100ms before 20ms.
function leadingNumber(cell: string): number | null {
  const m = /^[+-]?\d[\d,]*\.?\d*/.exec(cell.trim())
  if (!m) return null
  const n = Number(m[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// "No value" is not a small value, so these sink to the bottom either way.
function isBlank(cell: string): boolean {
  const v = cell.trim().toLowerCase()
  return v === '' || v === '-' || v === '--' || v === 'n/a'
}

function compareCells(a: string, b: string): number {
  const na = leadingNumber(a)
  const nb = leadingNumber(b)
  if (na != null && nb != null) return na - nb
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

// Exported for its own test: this is the whole behaviour of note 8, and it is
// the part with the edge cases - units, blanks, ties.
//
// Rows carry their arrival index, so blanks and ties keep the order the agent
// sent them in and the sort is stable whatever the engine does.
export function sortTableRows(
  rows: string[][],
  sort: Sort,
): { row: string[]; index: number }[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  if (!sort) return indexed
  const { col, dir } = sort
  return indexed.sort((x, y) => {
    const a = String(x.row[col] ?? '')
    const b = String(y.row[col] ?? '')
    const blankA = isBlank(a)
    const blankB = isBlank(b)
    if (blankA !== blankB) return blankA ? 1 : -1
    if (blankA) return x.index - y.index
    return (dir === 'asc' ? 1 : -1) * compareCells(a, b) || x.index - y.index
  })
}

function TableBlock({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const [sort, setSort] = useState<Sort>(null)

  const ordered = useMemo(() => sortTableRows(rows, sort), [rows, sort])

  // Ascending, descending, off.
  function cycle(col: number) {
    setSort((s) =>
      s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null,
    )
  }

  return (
    <div tabIndex={0} className="overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr>
            {columns.map((c, i) => {
              const on = sort?.col === i
              return (
                <th
                  key={i}
                  // The one thing a screen reader needs to know about a sortable
                  // column, and the only place that state is written down.
                  aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="border-b border-line p-0 text-left font-semibold whitespace-nowrap text-muted"
                >
                  <button
                    type="button"
                    onClick={() => cycle(i)}
                    className={`flex w-full items-center gap-1 px-2 py-1.5 text-left hover:text-text ${
                      on ? 'text-text' : ''
                    }`}
                  >
                    {c}
                    {on ? (
                      sort.dir === 'asc' ? (
                        <ChevronUp size={14} aria-hidden />
                      ) : (
                        <ChevronDown size={14} aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {/* Banding replaces the hairline that used to sit under every row:
              two ways of saying "the row ends here" is one more than the eye
              needs, and the shaded band is the one that also keeps a wide row
              on its own line across a scroll. The step is --color-surface over
              --color-bg, a surface and not a colour, because in this app a
              colour would claim to mean something. */}
          {ordered.map(({ row, index }, pos) => (
            // Striped on where the row sits now, not on where it arrived, so
            // the bands stay alternating after a sort. `index` stays the key,
            // so React moves the row it already has.
            <tr key={index} className={pos % 2 ? 'bg-surface' : undefined}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BlockRenderer({ blocks }: { blocks: unknown[] }) {
  return (
    <div className="flex flex-col gap-3">
      {(blocks as AnyBlock[]).map((b, i) => (
        <One key={i} b={b} />
      ))}
    </div>
  )
}

function One({ b }: { b: AnyBlock }) {
  switch (b.type) {
    case 'markdown':
      return <MiniMarkdown text={String(b.text ?? '')} />
    case 'callout':
      return <Callout tone={String(b.tone ?? 'info')}>{String(b.text ?? '')}</Callout>
    case 'progress': {
      const value = Number(b.value ?? 0)
      const max = Number(b.max ?? 100) || 100
      const pct = Math.max(0, Math.min(100, (value / max) * 100))
      return (
        <div>
          {b.label ? (
            <div className="mb-1 flex justify-between text-[15px] text-muted">
              <span>{String(b.label)}</span>
              <span>{Math.round(pct)}%</span>
            </div>
          ) : null}
          <div className="h-1 overflow-hidden bg-surface">
            <div className="h-full bg-kind-question" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )
    }
    case 'keyvalue': {
      const items = (b.items as { k: string; v: string }[]) ?? []
      return (
        <div className="grid gap-1">
          {items.map((it, i) => (
            <div key={i} className="flex justify-between gap-4">
              <span className="text-muted">{it.k}</span>
              <span className="text-right">{it.v}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'table':
      return (
        <TableBlock columns={(b.columns as string[]) ?? []} rows={(b.rows as string[][]) ?? []} />
      )
    case 'link':
      return (
        <a
          href={String(b.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1"
        >
          {String(b.label ?? b.url)}
          <ExternalLink size={14} aria-hidden />
        </a>
      )
    case 'image':
      return (
        <img
          src={String(b.url)}
          alt={String(b.alt ?? '')}
          className="max-w-full rounded-ui"
          loading="lazy"
        />
      )
    case 'code':
      // `lang` has been in the schema all along and the renderer used to drop
      // it on the floor.
      return <CodeBlock text={String(b.text ?? '')} lang={b.lang ? String(b.lang) : undefined} />
    // Interactive blocks are rendered by AnswerForm, not here.
    case 'buttons':
    case 'form':
      return null
    default:
      return null
  }
}

// -- Interactive: collect the answer and submit -------------------------------

// The answer area is one document, and any submit sends the whole of it: the
// values of the controls the agent sent, and the line of the human's own words
// under them, together. `current` is the document that stands, null while the
// question is still waiting; the controls open on it, so a second submit is a
// correction of what is there rather than a fresh start.
export function AnswerComposer({
  blocks,
  current,
  disabled,
  onSubmit,
}: {
  blocks: unknown[]
  current: AnswerDoc | null
  disabled?: boolean
  onSubmit: (doc: AnswerDoc) => void
}) {
  const interactive = (blocks as AnyBlock[]).filter(
    (b) => b.type === 'buttons' || b.type === 'form',
  )
  const standing = current?.answer ?? {}
  const [form, setForm] = useState<Record<string, Record<string, unknown>>>({})
  const [draft, setDraft] = useState(current?.text ?? '')

  const setField = (formId: string, fieldId: string, value: unknown) =>
    setForm((f) => ({ ...f, [formId]: { ...(f[formId] ?? {}), [fieldId]: value } }))

  const fieldValue = (formId: string, fieldId: string) => {
    const typed = form[formId]
    if (typed && fieldId in typed) return typed[fieldId]
    const stood = standing[formId]
    return stood && typeof stood === 'object' ? (stood as Record<string, unknown>)[fieldId] : undefined
  }

  const words = draft.trim()
  // Send carries the line as it stands. On a waiting question there has to be
  // something in it; on an answered one it has to differ from what stands,
  // because sending the same words again would only count as a change.
  const canSend = current ? words !== (current.text ?? '') : words.length > 0

  const send = (values: Record<string, unknown>) => onSubmit({ answer: values, text: words || null })

  return (
    <div className="flex flex-col gap-4">
      {interactive.map((b, i) => {
        if (b.type === 'buttons') {
          const options = (b.options as string[]) ?? []
          // Parallel to `options`, and short or absent: an option with no
          // entry falls back to its place in the palette.
          const styles = answerStyles(options, b.colors as string[] | undefined)
          const id = String(b.id)
          const chosen = standing[id]
          return (
            <div key={i} className="flex flex-wrap gap-2">
              {options.map((opt, oi) => (
                <Button
                  key={opt}
                  variant="answer"
                  style={styles[oi]}
                  aria-pressed={chosen === opt}
                  disabled={disabled}
                  onClick={() => send({ ...standing, [id]: opt })}
                >
                  {opt}
                </Button>
              ))}
            </div>
          )
        }
        // form
        const id = String(b.id)
        const fields = (b.fields as AnyBlock[]) ?? []
        return (
          <form
            key={i}
            onSubmit={(e) => {
              e.preventDefault()
              const values: Record<string, unknown> = {}
              for (const f of fields) values[String(f.id)] = fieldValue(id, String(f.id))
              send({ ...standing, [id]: values })
            }}
            className="flex flex-col gap-3"
          >
            {fields.map((f, fi) => (
              <FieldInput
                key={fi}
                field={f}
                value={fieldValue(id, String(f.id))}
                onChange={(v) => setField(id, String(f.id), v)}
              />
            ))}
            <Button type="submit" variant="primary" disabled={disabled} className="self-start">
              {String(b.submitLabel ?? 'Submit')}
            </Button>
          </form>
        )
      })}

      {/* Every question takes words, whatever controls it carries. Enter
          sends; Shift+Enter keeps writing. */}
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder="Or in your own words"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canSend && !disabled) send({ ...standing })
            }
          }}
          className={`${fieldClass} field-sizing-content max-h-40 resize-none`}
        />
        <IconButton
          aria-label="Send"
          disabled={disabled || !canSend}
          onClick={() => send({ ...standing })}
          className="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendHorizontal size={18} aria-hidden />
        </IconButton>
      </div>
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: AnyBlock
  value: unknown
  onChange: (v: unknown) => void
}) {
  const kind = String(field.kind)
  const label = String(field.label ?? '')
  const options = (field.options as string[]) ?? []
  const req = Boolean(field.required)

  const wrap = (child: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-[15px]">
      <span className="text-muted">
        {label}
        {req ? <span className="text-kind-error"> *</span> : null}
      </span>
      {child}
    </label>
  )

  if (kind === 'textarea')
    return wrap(
      <textarea
        required={req}
        rows={3}
        placeholder={String(field.placeholder ?? '')}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
      />,
    )
  if (kind === 'select')
    return wrap(
      <select
        required={req}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldClass} min-h-11`}
      >
        <option value="">Choose one</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>,
    )
  if (kind === 'radio')
    return wrap(
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o}
            variant={value === o ? 'primary' : 'secondary'}
            onClick={() => onChange(o)}
          >
            {o}
          </Button>
        ))}
      </div>,
    )
  if (kind === 'checkbox') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    return wrap(
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = arr.includes(o)
          return (
            <Button
              key={o}
              variant={on ? 'primary' : 'secondary'}
              onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
            >
              {o}
            </Button>
          )
        })}
      </div>,
    )
  }
  return wrap(
    <input
      type={kind === 'number' ? 'number' : 'text'}
      required={req}
      placeholder={String(field.placeholder ?? '')}
      value={String(value ?? '')}
      onChange={(e) => onChange(kind === 'number' ? e.target.valueAsNumber : e.target.value)}
      className={`${fieldClass} min-h-11`}
    />,
  )
}
