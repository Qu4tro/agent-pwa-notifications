import { KIND_BG, KIND_LABEL, KIND_TEXT, projectColor } from '../project'

// The kind of an event, as one word in the kind's colour. It is the only thing
// on a list row that is coloured, so the eye can sort a list by kind without
// reading it. Sentence case, not tracked caps: caps read as a terminal, and the
// colour already does the scanning work.
export function KindLabel({ kind, className = '' }: { kind: string; className?: string }) {
  return (
    <span
      className={`shrink-0 text-[13px] font-semibold ${
        KIND_TEXT[kind] ?? 'text-muted'
      } ${className}`}
    >
      {KIND_LABEL[kind] ?? 'Event'}
    </span>
  )
}

// Which project a row belongs to. A dot, not a tinted card: the colour is a
// tag, not a mood.
export function ProjectDot({ project, size = 8 }: { project: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: projectColor(project) }}
    />
  )
}

// An unread row keeps full-weight text and gets this dot. Colour says what
// kind of thing is waiting.
export function UnreadDot({ kind }: { kind: string }) {
  return (
    <span
      aria-label="Unread"
      className={`inline-block size-1.5 shrink-0 rounded-full ${KIND_BG[kind] ?? 'bg-muted'}`}
    />
  )
}
