import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Lock } from 'lucide-react'
import { type AnswerDoc, type ThreadData, type EventItem } from '../lib/api'
import { Container } from '../lib/shell'
import { ensure, threadQuery, useAnswer, useMarkRead } from '../lib/queries'
import { ThreadSkeleton } from '../lib/skeleton'
import {
  answerRowClass,
  QuestionDot,
  shortAnswer,
  useQuestionContent,
  prepareAnswer,
} from '../lib/question'
import { MessageModal, messageSearch, useMessageModal } from '../lib/message-modal'
import { projectLabel, fromParam, KIND_BORDER, STATE_TEXT } from '../lib/project'
import { InlineError, KindLabel, ProjectDot, Time } from '../lib/ui'

export const Route = createFileRoute('/_app/project/$name/task/$key')({
  ssr: false,
  // Which message is open, if one is: ?msg=, as on every page that opens one.
  validateSearch: messageSearch,
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
  const modal = useMessageModal(msg, Route.useNavigate())
  const project = fromParam(name)
  const { data: thread, isError, isFetched, refetch } = useQuery(threadQuery(project, key))
  const answer = useAnswer(project, key)
  const markRead = useMarkRead()
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null)

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
            onOpen={() => modal.open(e.id)}
            onClose={modal.close}
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

// The line above the title: what kind of thing this is, where it stands, who
// said it, and whether it is encrypted. Everything in here is phrasing
// content, because the row it sits in is a <button>.
function MessageHead({ e }: { e: EventItem }) {
  return (
    <span className="mb-1.5 flex items-center gap-2">
      <KindLabel kind={e.kind} />
      {/* Beside the kind word, because it says the same sort of thing about
          the same message. Only a question has a standing to say; an update,
          a done or an error has none, and gets nothing rather than a dot that
          would have to mean something. */}
      {e.question ? <QuestionDot question={e.question} /> : null}
      {e.model ? (
        <span className="min-w-0 truncate text-[13px] text-muted">{e.model}</span>
      ) : null}
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
