import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { AnswerDoc, EventItem, QuestionState } from './api'
import { AnswerComposer, Callout } from './blocks'
import { getEncKey, encryptValue, decryptValue } from './e2e'
import { Time } from './ui'

// The parts of a question that are the same wherever it is asked: the thread,
// where it sits in its conversation, and the live mode, where it is the only
// thing on the screen. Only the frame around them differs.

// Block content, and any answer, decrypted locally when the event is E2E.
// `locked` means the event is encrypted and this device has no key.
export function useQuestionContent(e: EventItem): {
  blocks: unknown[]
  answer: unknown
  text: string | null
  locked: boolean
} {
  const q = e.question
  // Plaintext is read straight off the event, on the first render. Going
  // through the effect would paint the card once with no blocks and no
  // buttons, and it would grow a frame later - mid-rise, in the live mode.
  const plain = e.enc
    ? null
    : { blocks: e.blocks as unknown[], answer: q?.answer ?? null, text: q?.text ?? null }
  const [dec, setDec] = useState<{ blocks: unknown[]; answer: unknown; text: string | null } | null>(
    null,
  )
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    if (!e.enc) return
    const key = getEncKey()
    if (!key) {
      setLocked(true)
      return
    }
    ;(async () => {
      try {
        const blocks = await decryptValue<unknown[]>(key, e.blocks as string)
        let answer: unknown = null
        let text: string | null = null
        // A just-submitted answer is still plaintext in the cache; only what
        // came back from the server is ciphertext.
        if (q?.answer)
          answer = typeof q.answer === 'string' ? await decryptValue(key, q.answer) : q.answer
        if (q?.text) text = await decryptValue<string>(key, q.text)
        setDec({ blocks, answer, text })
        setLocked(false)
      } catch {
        setLocked(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.enc, typeof e.blocks === 'string' ? e.blocks : '', q?.answer, q?.text])

  const content = plain ?? dec
  return {
    blocks: content?.blocks ?? [],
    answer: content?.answer ?? null,
    text: content?.text ?? null,
    locked,
  }
}

// For an E2E question, encrypt each part of the document before it leaves the
// device. The plaintext goes back as `display`, for the optimistic write and
// for whatever the screen says you answered. Null when the key is gone between
// render and tap, which is the one case where there is nothing to send.
// `ifPending` asks the server to write only while the question is waiting.
export async function prepareAnswer(
  e: EventItem,
  doc: AnswerDoc,
  { ifPending }: { ifPending?: boolean } = {},
): Promise<{ payload: Record<string, unknown>; display: AnswerDoc } | null> {
  const guard = ifPending ? { if_pending: true } : {}
  if (!e.enc) return { payload: { answer: doc.answer, text: doc.text, ...guard }, display: doc }
  const key = getEncKey()
  if (!key) return null
  return {
    payload: {
      enc: true,
      answer: await encryptValue(key, doc.answer),
      ...(doc.text ? { text: await encryptValue(key, doc.text) } : {}),
      ...guard,
    },
    display: doc,
  }
}

// The answer area: the controls the agent sent with the line of words under
// them, and whatever went wrong last time under that.
export function AnswerArea({
  blocks,
  current,
  disabled,
  error,
  onSubmit,
}: {
  blocks: unknown[]
  current: AnswerDoc | null
  disabled?: boolean
  error: string | null
  onSubmit: (doc: AnswerDoc) => void
}) {
  return (
    <>
      <AnswerComposer blocks={blocks} current={current} disabled={disabled} onSubmit={onSubmit} />
      {error ? <p className="mt-2 text-[15px] text-kind-error">{error}</p> : null}
    </>
  )
}

// Where the answer stands with the agent: given and waiting to be collected,
// collected, or changed since. The agent's own word back to you goes under it
// when it sent one.
export function AnswerStatus({
  question,
  answer,
  text,
  ack,
}: {
  question: QuestionState
  answer: unknown
  text: string | null
  ack: string | null
}) {
  if (question.status !== 'answered') return null
  const changed = question.changes > 0
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[15px] text-muted">
        {question.picked_up_at ? (
          <>
            {changed ? 'Agent received the change ' : 'Agent received it '}
            <Time at={question.picked_up_at} long />.
          </>
        ) : changed && question.answered_at ? (
          <>
            Changed <Time at={question.answered_at} long />. Waiting for the agent.
          </>
        ) : (
          'Waiting for the agent.'
        )}
      </div>
      {/* The agent's word back to you. Same chip as a callout the agent sent in
          its blocks, so "a note in a tone" has one look wherever it comes
          from. */}
      {ack ? (
        <div className="mt-1">
          <Callout tone="success">{ack.replace(/\{answer\}/g, shortAnswer(answer, text))}</Callout>
        </div>
      ) : null}
    </div>
  )
}

// What an encrypted event looks like on a device that cannot read it.
export function LockedNote() {
  return (
    <p className="text-[15px] text-muted">
      Encrypted. Add your key under Encryption in <Link to="/settings">Settings</Link> to read it.
    </p>
  )
}

// Short inline form of the answer, for the "You answered" line, the live
// mode's acknowledgement, and the ack's {answer} placeholder: the values, then
// the words in double quotes, joined with ", " - "Ocean", "audience: VC, tone:
// Punchy", or `Ship, "after the demo"`. Words alone read as the quote.
export function shortAnswer(answer: unknown, text?: string | null): string {
  const parts: string[] = []
  if (answer != null && typeof answer === 'object') {
    for (const v of Object.values(answer)) {
      if (v && typeof v === 'object')
        for (const [fk, fv] of Object.entries(v as Record<string, unknown>))
          parts.push(`${fk}: ${fv}`)
      else parts.push(String(v))
    }
  } else if (answer != null) {
    parts.push(String(answer))
  }
  if (text) parts.push(`"${text}"`)
  return parts.join(', ')
}
