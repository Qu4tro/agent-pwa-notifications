-- Superseded by the account-scoped indexes from 0007. agent_key_hash is
-- UNIQUE, so SQLite already keeps its own index on it.
DROP INDEX IF EXISTS idx_events_created;
DROP INDEX IF EXISTS idx_events_task;
DROP INDEX IF EXISTS idx_events_updated;
DROP INDEX IF EXISTS idx_events_project;
DROP INDEX IF EXISTS idx_accounts_key;
