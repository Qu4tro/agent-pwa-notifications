import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

// The one thing anyone wants to do with a block of text they cannot edit: a
// command, a key, a stack trace an agent sent. Used by Snippet and by the code
// blocks inside a message, so the control is the same wherever it appears.
//
// Always visible, never hover-only: there is no hover on a phone, and this is
// a phone app first. Not rendered at all where the clipboard is missing - an
// old WebView, or plain http that is not localhost - because a button that
// cannot do its job is worse than no button.
export function CopyButton({
  text,
  label,
  className = '',
}: {
  text: string
  // An accessible name, for the places where "Copy" alone does not say copy
  // what. Left off where the visible word is already the whole answer.
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  // Read after mount, so the first client render matches what the server sent.
  const [able, setAble] = useState(false)
  useEffect(() => setAble(typeof navigator !== 'undefined' && !!navigator.clipboard), [])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  if (!able) return null
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
      }}
      className={`ui-copy inline-flex min-h-11 items-center gap-1 rounded-ui bg-surface px-3 text-[13px] text-muted hover:text-text ${className}`}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
