import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Lock } from 'lucide-react'
import { timeAgo, type ThreadData, type EventItem } from '../lib/api'
import { BackLink, Container, useHeaderBack } from '../lib/shell'
import { ensure, threadQuery, useAnswer, useMarkRead } from '../lib/queries'
import { ThreadSkeleton } from '../lib/skeleton'
import { BlockRenderer, AnswerForm, Callout } from '../lib/blocks'
import { projectLabel, fromParam, KIND_BORDER, STATE_TEXT } from '../lib/project'
import { getEncKey, encryptValue, decryptValue } from '../lib/e2e'
import { InlineError, KindLabel, ProjectDot, Time } from '../lib/ui'

export const Route = createFileRoute('/_app/project/$name/task/$key')({
  ssr: false,
  // Where the reader came from, when the URL cannot say it. The header's back
  // control is an "up" link, not a history back, and this thread's parent in
  // the URL is its project - so a question opened from "Needs you", which is
  // not in that hierarchy, has to be told. One value, and anything else in the
  // query string is dropped: it survives a reload and a shared link, and the
  // label can be right, which `history.back()` could never be.
  validateSearch: (search: Record<string, unknown>): { from?: 'pending' } =>
    search.from === 'pending' ? { from: 'pending' } : {},
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
  const { from } = Route.useSearch()
  const project = fromParam(name)
  const { data: thread, isError, isFetched, refetch } = useQuery(threadQuery(project, key))
  const answer = useAnswer(project, key)
  const markRead = useMarkRead()
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null)

  useHeaderBack(
    from === 'pending' ? (
      <BackLink to="/pending" label="Needs you" />
    ) : (
      <BackLink to="/project/$name" params={{ name }} label={projectLabel(project)} />
    ),
    [name, project, from],
  )

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

  async function submit(
    eventId: string,
    payload: Record<string, unknown>,
    display: Record<string, unknown>,
  ) {
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
            <p className="mb-2 text-muted">This task no longer exists.</p>
            <Link to="/">Back to projects</Link>
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
        <div className="flex items-center gap-2 text-[15px] text-muted">
          <ProjectDot project={project} size={6} />
          <span className="truncate">{projectLabel(project)}</span>
        </div>
        <h1 className="text-[22px] leading-tight font-semibold">{title}</h1>
      </div>

      {/* The conversation: each message and question, newest at the top. */}
      <div className="flex flex-col">
        {newestFirst.map((e, i) => (
          <Message
            key={e.id}
            e={e}
            isNewest={i === 0}
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
// lives on the summary and the body, not here, because a closed message is
// only its summary.
//
// The time sits in a 56px gutter to the left of the rail - the same column the
// list rows use - and outside the <details>, so tapping it does not fold the
// message and its tooltip is its own, not the summary's.
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

// A message opens and closes as a native <details>. Nothing is wired up for the
// keyboard or for a screen reader here because the element already is: enter
// and space toggle it, and the summary is announced as expanded or collapsed.
function Collapsible({
  open,
  onOpenChange,
  summary,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details
      className="message group"
      open={open}
      onToggle={(ev) => onOpenChange(ev.currentTarget.open)}
    >
      <summary className="py-3 pr-4 pl-2.5">{summary}</summary>
      <div className="pr-4 pb-3 pl-2.5">{children}</div>
    </details>
  )
}

function MessageHead({ e }: { e: EventItem }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <KindLabel kind={e.kind} />
      {e.model ? <span className="truncate text-[13px] text-muted">{e.model}</span> : null}
      {e.enc ? (
        <span className="inline-flex items-center gap-1 text-[13px] text-kind-done">
          <Lock size={12} aria-hidden /> encrypted
        </span>
      ) : null}
      {/* The one thing that says this row opens. It points down when the
          message is shut and up when it is open. */}
      <ChevronDown
        size={16}
        aria-hidden
        className="ml-auto shrink-0 text-faint transition-transform group-open:rotate-180"
      />
    </div>
  )
}

function Message({
  e,
  isNewest,
  submitting,
  error,
  onSubmit,
}: {
  e: EventItem
  isNewest: boolean
  submitting: boolean
  error: string | null
  onSubmit: (payload: Record<string, unknown>, display: Record<string, unknown>) => void
}) {
  const q = e.question
  const isPending = q?.status === 'pending'

  // Open on arrival: a question still waiting on you, anything you have not
  // seen, and the last message in the thread, which is what you opened the
  // thread to read. Everything settled starts shut, which is the whole point
  // of the note: a long thread should read as a list of titles.
  //
  // Worked out once, at mount, and never again. The page marks what is on
  // screen as read and the 5 second poll brings that back, so a rule that was
  // re-read on every render would fold a message shut while you were reading
  // it. After that the state is yours: a tap is remembered until you leave.
  const [open, setOpen] = useState(() => isPending || e.read_at == null || isNewest)

  // Decrypt block content (and any answer) locally when the event is E2E.
  const [dec, setDec] = useState<{ blocks: unknown[]; answer: unknown } | null>(null)
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (!e.enc) {
      setDec({ blocks: e.blocks as unknown[], answer: q?.answer ?? null })
      return
    }
    const key = getEncKey()
    if (!key) {
      setLocked(true)
      return
    }
    ;(async () => {
      try {
        const blocks = await decryptValue<unknown[]>(key, e.blocks as string)
        let answer: unknown = null
        // A just-submitted answer is still plaintext in the cache; only what
        // came back from the server is ciphertext.
        if (q?.answer)
          answer = typeof q.answer === 'string' ? await decryptValue(key, q.answer) : q.answer
        setDec({ blocks, answer })
        setLocked(false)
      } catch {
        setLocked(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.enc, typeof e.blocks === 'string' ? e.blocks : '', q?.answer])

  // For E2E questions, encrypt the answer before it leaves the device. The
  // plaintext still goes to the optimistic cache write, so the answered state
  // renders without a round trip.
  async function handleSubmit(a: Record<string, unknown>) {
    if (!e.enc) return onSubmit(a, a)
    const key = getEncKey()
    if (!key) return
    const cipher = await encryptValue(key, a)
    onSubmit({ enc: true, answer: cipher }, a)
  }

  const blocks = dec?.blocks ?? []
  const answer = dec?.answer ?? null

  // The title, and for a settled question the answer you gave: enough to know
  // whether this one is worth opening.
  const head = (
    <>
      <MessageHead e={e} />
      {e.title ? <div className="leading-snug font-semibold">{e.title}</div> : null}
      {q?.status === 'answered' ? (
        <div className={`mt-0.5 truncate text-[15px] ${STATE_TEXT.answered}`}>
          You answered: <span className="font-semibold">{shortAnswer(answer)}</span>
        </div>
      ) : null}
    </>
  )

  if (locked) {
    return (
      <MessageShell kind={e.kind} at={e.created_at}>
        <Collapsible open={open} onOpenChange={setOpen} summary={head}>
          <p className="text-[15px] text-muted">
            Encrypted. Add your key under Encryption in <Link to="/settings">Settings</Link> to
            read it.
          </p>
        </Collapsible>
      </MessageShell>
    )
  }

  return (
    <MessageShell kind={e.kind} at={e.created_at}>
      <Collapsible open={open} onOpenChange={setOpen} summary={head}>
        <BlockRenderer blocks={blocks} />

        {q && (
          <div className="mt-3 border-t border-line pt-3">
            {isPending ? (
              <>
                <AnswerForm blocks={blocks} disabled={submitting} onSubmit={handleSubmit} />
                {error ? <p className="mt-2 text-[15px] text-kind-error">{error}</p> : null}
              </>
            ) : q.status === 'answered' ? (
              <div className="flex flex-col gap-1">
                {q.picked_up_at ? (
                  <>
                    <div className="text-[15px] text-muted">
                      Agent received it {timeAgo(q.picked_up_at)}
                    </div>
                    {/* The agent's word back to you. Same chip as a callout the
                        agent sent in its blocks, so "a note in a tone" has one
                        look wherever it comes from. */}
                    {e.ack ? (
                      <div className="mt-1">
                        <Callout tone="success">
                          {e.ack.replace(/\{answer\}/g, shortAnswer(answer))}
                        </Callout>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="text-[15px] text-muted">Waiting for the agent</div>
                )}
              </div>
            ) : (
              <div className={`text-[15px] ${STATE_TEXT.expired}`}>Expired before you answered.</div>
            )}
          </div>
        )}
      </Collapsible>
    </MessageShell>
  )
}

// Short inline form of the answer, for the "You answered" line and the ack's
// {answer} placeholder, e.g. "Ocean" or "audience: VC, tone: Punchy".
function shortAnswer(answer: unknown): string {
  if (answer == null) return ''
  if (typeof answer !== 'object') return String(answer)
  const parts: string[] = []
  for (const v of Object.values(answer)) {
    if (v && typeof v === 'object')
      for (const [fk, fv] of Object.entries(v as Record<string, unknown>)) parts.push(`${fk}: ${fv}`)
    else parts.push(String(v))
  }
  return parts.join(', ')
}
