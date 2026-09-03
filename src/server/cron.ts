import type { Env } from './env'
import { now } from './util'

// Hourly housekeeping (wrangler.jsonc crons). Keeps the inbox an inbox:
//   1. Expire overdue pending questions so polling agents get a verdict.
//   2. Archive events past their retention TTL - they leave the app, they do
//      not leave the database. Decided 2026-09-04, with note 4: nothing in the
//      app deletes on its own any more. Only the trash panel and the agent
//      `clear` endpoint delete, and both skip archived rows.
export async function runCron(env: Env): Promise<void> {
  const t = now()
  await env.DB.prepare(
    `UPDATE questions SET status = 'expired' WHERE status = 'pending' AND timeout_at < ?1`,
  )
    .bind(t)
    .run()
  await env.DB.prepare(
    'UPDATE events SET archived_at = ?1 WHERE expires_at < ?1 AND archived_at IS NULL',
  )
    .bind(t)
    .run()
}
