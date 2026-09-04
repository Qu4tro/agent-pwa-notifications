import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { EventItem } from './api'
import { AnswerForm } from './blocks'
import { getEncKey, encryptValue, decryptValue } from './e2e'

// The parts of a question that are the same wherever it is asked: the thread,
// where it sits in its conversation, and the live mode, where it is the only
// thing on the screen. Only the frame around them differs.

// Block content, and any answer, decrypted locally when the event is E2E.
// `locked` means the event is encrypted and this device has no key.
export function useQuestionContent(e: EventItem): {
  blocks: unknown[]
  answer: unknown
  locked: boolean
} {
  const q = e.question
  // Plaintext is read straight off the event, on the first render. Going
  // through the effect would paint the card once with no blocks and no
  // buttons, and it would grow a frame later - mid-rise, in the live mode.
  const plain = e.enc ? null : { blocks: e.blocks as unknown[], answer: q?.answer ?? null }
  const [dec, setDec] = useState<{ blocks: unknown[]; answer: unknown } | null>(null)
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

  const content = plain ?? dec
  return { blocks: content?.blocks ?? [], answer: content?.answer ?? null, locked }
}

// For an E2E question, encrypt the answer before it leaves the device. The
// plaintext goes back as `display`, for the optimistic write and for whatever
// the screen says you answered. Null when the key is gone between render and
// tap, which is the one case where there is nothing to send.
export async function prepareAnswer(
  e: EventItem,
  answer: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; display: Record<string, unknown> } | null> {
  if (!e.enc) return { payload: answer, display: answer }
  const key = getEncKey()
  if (!key) return null
  return { payload: { enc: true, answer: await encryptValue(key, answer) }, display: answer }
}

// The answer area: the controls the agent sent, and whatever went wrong last
// time under them.
export function AnswerArea({
  blocks,
  disabled,
  error,
  onSubmit,
}: {
  blocks: unknown[]
  disabled?: boolean
  error: string | null
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  return (
    <>
      <AnswerForm blocks={blocks} disabled={disabled} onSubmit={onSubmit} />
      {error ? <p className="mt-2 text-[15px] text-kind-error">{error}</p> : null}
    </>
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
// mode's acknowledgement, and the ack's {answer} placeholder, e.g. "Ocean" or
// "audience: VC, tone: Punchy".
export function shortAnswer(answer: unknown): string {
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
