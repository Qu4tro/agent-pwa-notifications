-- `text` holds the human's own words beside the values in `answer` (ciphertext
-- when the event is encrypted), so every question takes a reply in prose even
-- when it carries no control.
ALTER TABLE questions ADD COLUMN text TEXT;

-- `changes` counts how many times the answer was replaced after it was first
-- given, so the agent can tell a new answer from the one it already read.
ALTER TABLE questions ADD COLUMN changes INTEGER NOT NULL DEFAULT 0;
