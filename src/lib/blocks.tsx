import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, fieldClass } from './ui'

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

function MiniMarkdown({ text }: { text: string }) {
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
  return <div className="md text-[14px]">{out}</div>
}

// -- Display blocks ----------------------------------------------------------
type AnyBlock = Record<string, unknown> & { type: string }

// A callout's tone is the agent's word for what it is saying. Three of them
// are kind colours; warn is its own token.
const TONE: Record<string, string> = {
  info: 'border-l-kind-update',
  success: 'border-l-kind-done',
  warn: 'border-l-warn',
  error: 'border-l-kind-error',
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
    case 'callout': {
      const tone = String(b.tone ?? 'info')
      return (
        <div className={`border-l-[3px] py-0.5 pl-2 text-[14px] ${TONE[tone] ?? TONE.info}`}>
          {String(b.text ?? '')}
        </div>
      )
    }
    case 'progress': {
      const value = Number(b.value ?? 0)
      const max = Number(b.max ?? 100) || 100
      const pct = Math.max(0, Math.min(100, (value / max) * 100))
      return (
        <div>
          {b.label ? (
            <div className="mb-1 flex justify-between text-[13px] text-muted">
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
        <div className="grid gap-1 text-[14px]">
          {items.map((it, i) => (
            <div key={i} className="flex justify-between gap-4">
              <span className="text-muted">{it.k}</span>
              <span className="text-right">{it.v}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'table': {
      const columns = (b.columns as string[]) ?? []
      const rows = (b.rows as string[][]) ?? []
      return (
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={i}
                    className="border-b border-line px-2 py-1 text-left font-semibold whitespace-nowrap text-muted"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td key={ci} className="border-b border-line px-2 py-1 last:border-b-0">
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
    case 'link':
      return (
        <a
          href={String(b.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[14px]"
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
      return (
        <pre tabIndex={0} className="overflow-x-auto rounded-ui bg-surface p-2 text-[12.5px]">
          <code>{String(b.text ?? '')}</code>
        </pre>
      )
    // Interactive blocks are rendered by AnswerForm, not here.
    case 'buttons':
    case 'form':
      return null
    default:
      return null
  }
}

// -- Interactive: collect the answer and submit -------------------------------
export function AnswerForm({
  blocks,
  disabled,
  onSubmit,
}: {
  blocks: unknown[]
  disabled?: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const interactive = (blocks as AnyBlock[]).filter(
    (b) => b.type === 'buttons' || b.type === 'form',
  )
  const [form, setForm] = useState<Record<string, Record<string, unknown>>>({})

  const setField = (formId: string, fieldId: string, value: unknown) =>
    setForm((f) => ({ ...f, [formId]: { ...(f[formId] ?? {}), [fieldId]: value } }))

  return (
    <div className="flex flex-col gap-4">
      {interactive.map((b, i) => {
        if (b.type === 'buttons') {
          const options = (b.options as string[]) ?? []
          const id = String(b.id)
          return (
            <div key={i} className="flex flex-wrap gap-2">
              {options.map((opt) => (
                <Button
                  key={opt}
                  variant="primary"
                  disabled={disabled}
                  onClick={() => onSubmit({ [id]: opt })}
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
              onSubmit({ [id]: form[id] ?? {} })
            }}
            className="flex flex-col gap-3"
          >
            {fields.map((f, fi) => (
              <FieldInput
                key={fi}
                field={f}
                value={form[id]?.[String(f.id)]}
                onChange={(v) => setField(id, String(f.id), v)}
              />
            ))}
            <Button type="submit" variant="primary" disabled={disabled} className="self-start">
              {String(b.submitLabel ?? 'Submit')}
            </Button>
          </form>
        )
      })}
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
