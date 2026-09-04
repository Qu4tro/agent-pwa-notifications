import { CopyButton } from './copy'

// A command or a key, with the one thing anyone wants to do with it.
export function Snippet({ text }: { text: string }) {
  return (
    <div className="relative">
      <pre tabIndex={0} className="overflow-x-auto rounded-ui bg-surface p-3 pr-24">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} className="absolute top-px right-px" />
    </div>
  )
}
