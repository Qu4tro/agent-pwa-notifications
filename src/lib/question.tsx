import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { AnswerDoc, EventItem, QuestionState } from './api'
import { AnswerComposer, Callout } from './blocks'
import { getEncKey, encryptValue, decryptValue } from './e2e'
import { Button, Time } from './ui'

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
//
// A question that is still waiting is a form, and it opens as one. A question
// you have already answered is not: it is a thing you did, with a way to undo
// it. Showing the answer and a live set of controls at the same time said both
// at once - the buttons offered a choice already made, and the "or in your own
// words" box sat empty under words you had already written. So an answered
// question shows what stands and one control, and the composer comes back only
// when you ask for it and goes away again when you dismiss it. The words you
// wrote are in the box when it opens, because correcting them is the reason
// you opened it.
export function AnswerArea({
  blocks,
  current,
  disabled,
  error,
  correcting,
  onCorrecting,
  holdOpen,
  onSubmit,
}: {
  blocks: unknown[]
  current: AnswerDoc | null
  disabled?: boolean
  error: string | null
  // Held by the caller, because the control that opens the composer does not
  // sit where the composer does: it belongs on the same line as the answer it
  // changes, and that line is the caller's - a message's summary in a thread,
  // the card's own line in the live mode.
  correcting: boolean
  onCorrecting: (v: boolean) => void
  // Hold the composer up whatever the answer says, and without a Dismiss on
  // it. The live mode asks for this while it acknowledges an answer: the area
  // is fading out under the acknowledgement, and anything that changed its
  // height there would move the card at the one moment nothing should.
  holdOpen?: boolean
  onSubmit: (doc: AnswerDoc) => void
}) {
  // The composer closes on submit, before the round trip is over, because the
  // optimistic write means what stands is already the new answer. A submit
  // that failed brings it back with the message under it - closing on the way
  // to an error would leave the failure with nothing to correct. Dismiss still
  // wins over that, so the way out is never blocked by an error.
  useEffect(() => {
    if (error) onCorrecting(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  // An answered question with the composer shut has nothing here: what stands
  // is on the caller's line, and the status under it says where it got to.
  if (current != null && !correcting && !holdOpen) return null

  return (
    <div className="flex flex-col gap-3">
      <AnswerComposer
        blocks={blocks}
        current={current}
        disabled={disabled}
        onSubmit={(doc) => {
          onCorrecting(false)
          onSubmit(doc)
        }}
      />
      {error ? <p className="text-[15px] text-kind-error">{error}</p> : null}
      {/* Only on a correction you opened: there is nothing to dismiss back to
          on a question that has never been answered, and nothing to dismiss at
          all on one being held open. */}
      {current != null && correcting ? (
        <Button variant="secondary" className="self-start" onClick={() => onCorrecting(false)}>
          Dismiss
        </Button>
      ) : null}
    </div>
  )
}

// The answer's own row: what stands, and the way to change it. Marked off from
// the title above it by a step in surface rather than a colour, because colour
// here means the kind of a thing and the state of a question, and this row is
// neither - it is the same answered green as the words in it.
//
// The step goes the other way in the live mode, whose card is already
// --color-surface, so the caller brings the surface and this brings the shape.
// The negative margin is the usual trick: the background bleeds into the
// padding while every word stays on the line it was on.
export const answerRowClass = '-mx-2 flex items-center gap-3 rounded-ui px-2'

// The way back into an answered question, and it lives on the answer's own
// line, hard right. Light enough not to compete with the answer beside it, and
// still 44px tall, because a control on a phone is a thumb's target whatever it
// looks like. preventDefault so that on a thread, where this line is a
// <summary>, opening the composer does not fold the message shut on the way.
export function ChangeAnswer({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        onClick()
      }}
      className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-ui px-2 text-[15px] text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      Change answer
    </button>
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
