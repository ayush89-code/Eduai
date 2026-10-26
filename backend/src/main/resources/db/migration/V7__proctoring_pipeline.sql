-- Step 9: proctoring events arrive through Kafka (at-least-once), so inserts must be idempotent.
-- event_id is derived from (attempt, client id): the same event delivered twice is stored once.
ALTER TABLE proctoring_events ADD COLUMN IF NOT EXISTS event_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proctoring_event_id ON proctoring_events (event_id);

-- running totals per attempt, updated by the Kafka consumer (the teacher dashboard of Step 10 reads these)
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS flag_count INT NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0;
