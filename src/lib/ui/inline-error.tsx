import { AlertCircle } from 'lucide-react'
import { Button } from './button'

// What a page shows when its query failed and there is nothing cached to show
// instead. One line, one button, inside the content area. Never a blank page.
export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-y border-line px-3 py-2">
      <AlertCircle size={16} className="shrink-0 text-kind-error" aria-hidden />
      <span className="text-[14px] text-muted">{message}</span>
      <Button onClick={onRetry} className="ml-auto">
        Retry
      </Button>
    </div>
  )
}
