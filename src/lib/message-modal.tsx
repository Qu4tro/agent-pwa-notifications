import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Lock, X } from 'lucide-react'
import type { AnswerDoc, EventItem } from './api'
import { BlockRenderer } from './blocks'
import {
  AnswerArea,
  AnswerStatus,
  ChangeAnswer,
  answerRowClass,
  LockedNote,
  shortAnswer,
  useQuestionContent,
} from './question'
import { KIND_BORDER, KIND_LABEL, STATE_TEXT } from './project'
import { IconButton, KindLabel, Time } from './ui'

// One message, over the page it was opened from. The thread opens each of its
// rows into one of these; a list opens the question a waiting row is asking
// into the same one, so a message reads the same wherever it was opened from.

// Which message is open is in the address, as ?msg=, rather than in a hook's
// state: opening one is then a step in the router's own history, so the
// phone's back button closes it without anything listening for it, and a
// reload or a shared link comes back to the same message. Every page that
// opens messages validates its search with this.
export function messageSearch(search: Record<string, unknown>): { msg?: string } {
  return { msg: typeof search.msg === 'string' ? search.msg : undefined }
}

// The way in and the way out. Opening pushes; closing steps back over what was
// pushed, so Close, Escape, the backdrop and the back button all leave the
// same history behind them. A message reached by a link straight into ?msg=
// has nothing behind it in this app, so that one drops the parameter instead
// of stepping out of the site.
//
// `navigate` is the page's own, from Route.useNavigate(), so what it writes
// is typed against that page's search.
export function useMessageModal(
  msg: string | undefined,
  navigate: (opts: { search: { msg?: string }; replace?: boolean }) => unknown,
) {
  const router = useRouter()
  const pushed = useRef(false)
  useEffect(() => {
    if (!msg) pushed.current = false
  }, [msg])
  function open(id: string) {
    pushed.current = true
    void navigate({ search: { msg: id } })
  }
  function close() {
    if (pushed.current) router.history.back()
    else void navigate({ search: { msg: undefined }, replace: true })
  }
  return { open, close }
}

// The whole of one message, over the thread it belongs to: what its row says,
// and under that the blocks and - on a question - the controls, the answer
// that stands and where that answer got to.
//
// A native <dialog> opened with showModal(). The top layer, the backdrop, the
// focus trap, the rest of the page going inert and Escape are all the
// browser's; the tap on the backdrop and the way back are what is written
// here.
export function MessageModal({
  e,
  content,
  row,
  submitting,
  error,
  correcting,
  onCorrecting,
  onClose,
  onSubmit,
}: {
  e: EventItem
  content: ReturnType<typeof useQuestionContent>
  row: React.RefObject<HTMLElement | null>
  submitting: boolean
  error: string | null
  correcting: boolean
  onCorrecting: (v: boolean) => void
  onClose: () => void
  onSubmit: (doc: AnswerDoc) => void
}) {
  const { blocks, answer, text, locked } = content
  const q = e.question
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = dialog.current
    // Not while it is already up: showModal() on an open dialog throws, and in
    // development React mounts an effect, tears it down and mounts it again.
    if (d && !d.open) d.showModal()
    // Nothing closes the dialog on the way out. React takes the element away
    // and a modal that leaves the document leaves the top layer with it;
    // calling close() here would fire `close` on a dialog that is already
    // going, and the route would be asked to step back a second time.
    //
    // What is left is the focus: back to the row this came from, which is
    // where the reader was. The browser restores it by itself only when it had
    // somewhere to restore it to, and a tap on a phone leaves it nowhere.
    return () => row.current?.focus()
  }, [row])

  const current: AnswerDoc | null =
    q?.status === 'answered'
      ? { answer: (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>, text }
      : null

  return (
    <dialog
      ref={dialog}
      aria-label={e.title || KIND_LABEL[e.kind] || 'Message'}
      onClose={onClose}
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70"
    >
      {/* The panel is the modal and everything around it is the way out, so a
          click that lands on this layer and not inside the panel is a click on
          the backdrop. Under 640px the panel is the width of the screen and
          this layer has no padding at its sides; the backdrop is then the
          strip above it and the strip below. */}
      <div
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) onClose()
        }}
        className="flex h-full w-full items-center justify-center sm:p-4"
      >
        {/* Shaped like the message it stands for: the surface, an edge, and
            the kind colour as a 3px rail down the left. */}
        <div
          className={`flex max-h-full w-full flex-col border border-l-[3px] border-edge bg-surface text-text sm:max-w-[40rem] sm:rounded-ui ${
            KIND_BORDER[e.kind] ?? 'border-l-line'
          }`}
        >
          {/* The head stays while the message scrolls under it, because the
              way out is on it. */}
          <div className="flex shrink-0 items-start gap-2 pt-2 pr-2 pb-1 pl-4">
            <span className="mt-2.5 flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <KindLabel kind={e.kind} />
              {e.model ? <span className="truncate text-[13px] text-muted">{e.model}</span> : null}
              {e.enc ? (
                <span className="inline-flex items-center gap-1 text-[13px] text-kind-done">
                  <Lock size={12} aria-hidden /> encrypted
                </span>
              ) : null}
              {/* The row's time is in the gutter, which the modal has not got,
                  so here it says it in words. */}
              <span className="text-[13px] text-faint">
                <Time at={e.created_at} long />
              </span>
            </span>
            <IconButton aria-label="Close" onClick={onClose}>
              <X size={20} aria-hidden />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-4">
            {e.title ? (
              <h2 className="mb-3 text-[19px] leading-tight font-semibold">{e.title}</h2>
            ) : null}

            {locked ? (
              <LockedNote />
            ) : (
              <>
                <BlockRenderer blocks={blocks} />

                {q && (
                  <div className="mt-4 border-t border-line pt-3">
                    {q.status === 'expired' ? (
                      <div className={`text-[15px] ${STATE_TEXT.expired}`}>
                        Expired before you answered.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {/* What stands is on the row as well, but the row is
                            behind the backdrop now, and the control that
                            changes an answer belongs on the line it changes.
                            The step in surface goes down here and not up: this
                            panel is already --color-surface. */}
                        {current && !correcting ? (
                          <div
                            className={`${answerRowClass} bg-bg text-[15px] ${STATE_TEXT.answered}`}
                          >
                            <span className="min-w-0 flex-1">
                              You answered:{' '}
                              <span className="font-semibold">{shortAnswer(answer, text)}</span>
                            </span>
                            <ChangeAnswer
                              disabled={submitting}
                              onClick={() => onCorrecting(true)}
                            />
                          </div>
                        ) : null}
                        <AnswerArea
                          blocks={blocks}
                          current={current}
                          disabled={submitting}
                          error={error}
                          correcting={correcting}
                          onCorrecting={onCorrecting}
                          onSubmit={onSubmit}
                        />
                        <AnswerStatus question={q} answer={answer} text={text} ack={e.ack} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}
