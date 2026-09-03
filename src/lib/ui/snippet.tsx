import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

// A command or a key, with the one thing anyone wants to do with it.
export function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre tabIndex={0} className="overflow-x-auto rounded-ui bg-surface p-2 pr-20 text-[12px]">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="absolute top-px right-px inline-flex min-h-9 items-center gap-1 rounded-ui bg-surface px-2 text-[12px] text-muted hover:text-text"
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
