import { useEffect, useState } from 'react'

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

  return (
    <pre tabIndex={0} className="hl overflow-x-auto rounded-ui bg-surface p-3">
      <code>{tokens ?? text}</code>
    </pre>
  )
}
