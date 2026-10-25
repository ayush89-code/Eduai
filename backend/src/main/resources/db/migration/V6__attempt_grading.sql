-- Step 8: grading state for student answers + a counter of answers waiting for the teacher
-- answers.grading: PENDING (attempt still running) | AUTO (scored by the system)
--                  | AWAITING (needs the teacher's marks) | MANUAL (marked by the teacher)
ALTER TABLE answers ADD COLUMN IF NOT EXISTS grading   VARCHAR(10) NOT NULL DEFAULT 'PENDING';
ALTER TABLE answers ADD COLUMN IF NOT EXISTS feedback  TEXT;
ALTER TABLE answers ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;
ALTER TABLE answers ADD CONSTRAINT answers_grading_check
    CHECK (grading IN ('PENDING', 'AUTO', 'AWAITING', 'MANUAL'));

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS pending_count INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_attempts_exam ON attempts (exam_id);
