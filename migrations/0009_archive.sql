-- Note 4: "Done" gets a Clear button that archives.
--
-- The only clear the app had deleted. This is the other half: take a finished
-- thread out of the app without taking it out of the database. A stamped row
-- is invisible to every dashboard read and to the agent inbox; nothing in the
-- UI ever lists it again.
--
-- The retention cron stamps this column now instead of running a DELETE, so
-- after this migration nothing in the app deletes on its own. Only the trash
-- panel and the agent `clear` endpoint delete, and both skip archived rows.
-- Storage only grows, at roughly 1 KB an event, which D1 does not notice.
ALTER TABLE events ADD COLUMN archived_at INTEGER;

-- Every dashboard read now filters on this, next to account_id.
CREATE INDEX IF NOT EXISTS idx_events_acct_archived ON events (account_id, archived_at);
