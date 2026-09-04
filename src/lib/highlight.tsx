import { useEffect, useState } from 'react'
import { CopyButton } from './ui'

// A code block. The plain text paints straight away and the colours arrive
// after, if they arrive at all: the highlighter is a separate chunk, fetched
// by the effect below, and a thread with no code in it never asks for it.
// Nothing here can delay a message from rendering, and nothing here can stop
// one from rendering either - a grammar that fails leaves the plain block.
export function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  const [tokens, setTokens] = useState<React.ReactNode | null>(null)

  useEffect(() => {
    setTokens(null)
    if (!lang) return
    let live = true
    import('./hl')
      .then((hl) => {
        const nodes = hl.highlightToNodes(text, lang)
        if (live && nodes) setTokens(nodes)
      })
      .catch(() => {
        // Offline, or the chunk 404s after a deploy. The plain block stands.
      })
    return () => {
      live = false
    }
  }, [text, lang])

  // The button copies `text`, the raw string the agent sent - never the
  // highlighted DOM, which would carry the markup with it.
  //
  // It sits in a strip above the block rather than on top of it. Laid over the
  // block, as Snippet lays it over a one-line command, it covered the middle
  // of the first line of the seed's iOS push trace at 360px: a pre's right
  // padding is at the end of the scrollable content, not at the visible right
  // edge, so a long line simply runs under the button. The plan named this as
  // the fallback if that happened, and it did. The strip costs a line per
  // block and gives `lang` the only place it has ever had to show.
  return (
    <div className="rounded-ui bg-surface">
      <div className="flex items-center gap-2 pl-3">
        <span className="min-w-0 truncate text-[13px] text-faint">{lang}</span>
        <CopyButton text={text} label="Copy code" className="ml-auto" />
      </div>
      <pre tabIndex={0} className="hl overflow-x-auto px-3 pb-3">
        <code>{tokens ?? text}</code>
      </pre>
    </div>
  )
}
