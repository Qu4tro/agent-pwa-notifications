import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Lock, X } from 'lucide-react'
import { type AnswerDoc, type ThreadData, type EventItem } from '../lib/api'
import { Container } from '../lib/shell'
import { ensure, threadQuery, useAnswer, useMarkRead } from '../lib/queries'
import { ThreadSkeleton } from '../lib/skeleton'
import { BlockRenderer } from '../lib/blocks'
import {
  AnswerArea,
  AnswerStatus,
  ChangeAnswer,
  answerRowClass,
  LockedNote,
  shortAnswer,
  useQuestionContent,
  prepareAnswer,
} from '../lib/question'
import { projectLabel, fromParam, KIND_BORDER, KIND_LABEL, STATE_TEXT } from '../lib/project'
import { IconButton, InlineError, KindLabel, ProjectDot, Time } from '../lib/ui'

export const Route = createFileRoute('/_app/project/$name/task/$key')({
  ssr: false,
  // Which message is open, if one is. It lives in the address rather than in a
  // hook's state so that opening one is a step in the router's own history:
  // the phone's back button closes the modal without anything here listening
  // for it, and a reload or a shared link comes back to the same message.
  validateSearch: (search: Record<string, unknown>): { msg?: string } => ({
    msg: typeof search.msg === 'string' ? search.msg : undefined,
  }),
  loader: ({ context, params }) =>
    context.signedIn
      ? ensure<ThreadData | null>(
          context.queryClient,
          threadQuery(fromParam(params.name), params.key),
        )
      : undefined,
  pendingComponent: ThreadSkeleton,
  component: ThreadView,
})

function ThreadView() {
  const { name, key } = Route.useParams()
  const { msg } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const project = fromParam(name)
  const { data: thread, isError, isFetched, refetch } = useQuery(threadQuery(project, key))
  const answer = useAnswer(project, key)
  const markRead = useMarkRead()
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null)

  // Whether the entry the modal stands on is one this page pushed. Opening a
  // message pushes; closing steps back over it, so Close, Escape, the backdrop
  // and the back button all leave the same history behind them. A message
  // reached by a link straight into ?msg= has nothing behind it in this app,
  // so that one drops the parameter instead of stepping out of the site.
  const pushed = useRef(false)
  useEffect(() => {
    if (!msg) pushed.current = false
  }, [msg])
  function openMessage(id: string) {
    pushed.current = true
    void navigate({ search: { msg: id } })
  }
  function closeMessage() {
    if (pushed.current) router.history.back()
    else void navigate({ search: { msg: undefined }, replace: true })
  }

  // Ids already sent to /read, so a refresh that overlaps the round trip does
  // not POST the same event twice.
  const marked = useRef(new Set<string>())
  const markMutate = markRead.mutate
  useEffect(() => {
    if (!thread) return
    // Mark non-pending unread events read on EVERY refresh, not only the
    // first. Events that land while the thread is open (the agent's follow-up
    // after an answer) would otherwise stay unread for ever, which keeps the
    // thread row on the project page and survives "clear read". Pending
    // questions stay unread until answered, so they keep surfacing in
    // "Needs you".
    for (const e of thread.events) {
      if (e.read_at != null || e.question?.status === 'pending') continue
      if (marked.current.has(e.id)) continue
      marked.current.add(e.id)
      markMutate(e.id, { onError: () => marked.current.delete(e.id) })
    }
  }, [thread, markMutate])

  async function submit(eventId: string, payload: Record<string, unknown>, display: AnswerDoc) {
    setFailed(null)
    try {
      await answer.mutateAsync({ eventId, payload, display })
    } catch (e) {
      setFailed({ id: eventId, message: (e as Error).message || 'Could not submit.' })
    }
  }

  if (!thread) {
    if (!isFetched && !isError) return <ThreadSkeleton />
    return (
      <Container>
        {isError ? (
          <InlineError message="Could not load this thread." onRetry={() => refetch()} />
        ) : (
          <div className="px-4 py-12 text-center">
            <p className="text-muted">This task no longer exists.</p>
          </div>
        )}
      </Container>
    )
  }

  // Read off the server's array, which is still oldest first: the thread is
  // named after the event that started it, not the one that ended it.
  const title = thread.task || thread.events[0]?.title || 'Task'

  // Newest first on the page. Reversed here rather than in the query, so the
  // API's order - which the title above, the tests and everything that reads
  // the array by position depend on - is left alone. A real reversal, not
  // flex-col-reverse: that would leave the DOM oldest first, and the keyboard
  // and a screen reader would walk the thread against the eye.
  const newestFirst = [...thread.events].reverse()

  return (
    <Container>
      <div className="mb-4 px-4">
        {/* The thread's parent, and the way up to it. The header's title goes
            to the project list; this line is the step in between, and it was
            already here saying which project this is. */}
        <Link
          to="/project/$name"
          params={{ name }}
          className="flex items-center gap-2 text-[15px] text-muted no-underline hover:text-text"
        >
          <ProjectDot project={project} size={6} />
          <span className="truncate">{projectLabel(project)}</span>
        </Link>
        <h1 className="text-[22px] leading-tight font-semibold">{title}</h1>
      </div>

      {/* The conversation: one shut row per message and question, newest at
          the top. */}
      <div className="flex flex-col">
        {newestFirst.map((e) => (
          <Message
            key={e.id}
            e={e}
            open={msg === e.id}
            onOpen={() => openMessage(e.id)}
            onClose={closeMessage}
            submitting={answer.isPending && answer.variables?.eventId === e.id}
            error={failed?.id === e.id ? failed.message : null}
            onSubmit={(payload, display) => submit(e.id, payload, display)}
          />
        ))}
      </div>
    </Container>
  )
}

// One message. The 3px rail is the kind colour; the rest of the block has no
// border and no background, so a long thread reads as one column. The padding
// lives on the row, not here, because a message on the page is only its row.
//
// The time sits in a 56px gutter to the left of the rail - the same column the
// list rows use - and outside the row's own control, so tapping it does not
// open the message and its tooltip is its own, not the row's.
function MessageShell({
  kind,
  at,
  children,
}: {
  kind: string
  at: number
  children: React.ReactNode
}) {
  return (
    <article className="flex border-b border-b-line last:border-b-0">
      <div className="w-14 shrink-0 pt-3 pr-1.5 pl-4 text-right text-[13px] leading-[20px] whitespace-nowrap text-faint">
        <Time at={at} />
      </div>
      <div className={`min-w-0 flex-1 border-l-[3px] ${KIND_BORDER[kind] ?? 'border-l-line'}`}>
        {children}
      </div>
    </article>
  )
}

// The line above the title: what kind of thing this is, who said it, and
// whether it is encrypted. Everything in here is phrasing content, because the
// row it sits in is a <button>.
function MessageHead({ e }: { e: EventItem }) {
  return (
    <span className="mb-1.5 flex items-center gap-2">
      <KindLabel kind={e.kind} />
      {e.model ? <span className="truncate text-[13px] text-muted">{e.model}</span> : null}
      {e.enc ? (
        <span className="inline-flex items-center gap-1 text-[13px] text-kind-done">
          <Lock size={12} aria-hidden /> encrypted
        </span>
      ) : null}
      {/* The one thing that says this row opens. It points the way the message
          arrives: sideways, over the thread, rather than down into it. */}
      <ChevronRight
        size={16}
        aria-hidden
        className="ml-auto shrink-0 text-faint transition-colors group-hover:text-text"
      />
    </span>
  )
}

function Message({
  e,
  open,
  onOpen,
  onClose,
  submitting,
  error,
  onSubmit,
}: {
  e: EventItem
  open: boolean
  onOpen: () => void
  onClose: () => void
  submitting: boolean
  error: string | null
  onSubmit: (payload: Record<string, unknown>, display: AnswerDoc) => void
}) {
  const q = e.question
  const isPending = q?.status === 'pending'
  const row = useRef<HTMLButtonElement>(null)
  // Held here and not in the modal, so a submit that failed after the modal
  // was shut has somewhere to come back to: opening the message again lands on
  // the composer with the message it belongs to under it.
  const [correcting, setCorrecting] = useState(false)

  const content = useQuestionContent(e)
  const { answer, text } = content

  // While the question is waiting, the submit asks the server to write only if
  // it still is, so a tap here loses to an answer already given somewhere else
  // rather than overwriting it. Once it is answered, this composer is the place
  // that changes it, so the guard comes off.
  async function handleSubmit(doc: AnswerDoc) {
    const prepared = await prepareAnswer(e, doc, { ifPending: isPending })
    if (prepared) onSubmit(prepared.payload, prepared.display)
  }

  return (
    <MessageShell kind={e.kind} at={e.created_at}>
      {/* Every message stands shut - the newest one and a question still
          waiting with the rest of them - so the thread reads as a list of
          titles. What is on the row is what says whether this one is worth
          opening: the kind, the title, and on a settled question the answer
          that stands.

          A real <button>, so the row is in the tab order and Enter and Space
          open it with no key handling of our own. Its content is spans and not
          divs because what may sit inside a button is phrasing content. */}
      <button
        ref={row}
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className="group block w-full cursor-pointer py-3 pr-4 pl-2.5 text-left"
      >
        <MessageHead e={e} />
        {e.title ? <span className="block leading-snug font-semibold">{e.title}</span> : null}
        {q?.status === 'answered' ? (
          <span className={`mt-1.5 ${answerRowClass} bg-surface text-[15px] ${STATE_TEXT.answered}`}>
            <span className="min-w-0 flex-1 truncate">
              You answered: <span className="font-semibold">{shortAnswer(answer, text)}</span>
            </span>
          </span>
        ) : null}
      </button>

      {open ? (
        <MessageModal
          e={e}
          content={content}
          row={row}
          submitting={submitting}
          error={error}
          correcting={correcting}
          onCorrecting={setCorrecting}
          onClose={onClose}
          onSubmit={handleSubmit}
        />
      ) : null}
    </MessageShell>
  )
}

// The whole of one message, over the thread it belongs to: what its row says,
// and under that the blocks and - on a question - the controls, the answer
// that stands and where that answer got to.
//
// A native <dialog> opened with showModal(). The top layer, the backdrop, the
// focus trap, the rest of the page going inert and Escape are all the
// browser's; the tap on the backdrop and the way back are what is written
// here.
function MessageModal({
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
  row: React.RefObject<HTMLButtonElement | null>
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
