-- Step 6: question generation
-- 1) more question types (V1 allowed only MCQ / SUBJECTIVE / TRUE_FALSE)
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ALTER COLUMN type TYPE VARCHAR(20);
ALTER TABLE questions ADD CONSTRAINT questions_type_check CHECK (type IN (
    'MCQ', 'TRUE_FALSE', 'SUBJECTIVE',            -- SUBJECTIVE kept for backward compatibility
    'FILL_BLANK', 'SHORT_ANSWER', 'LONG_ANSWER', 'MATCH', 'CASE_BASED'));

-- 2) type-specific data that does not fit the base columns
--    MATCH: left/right columns + answer key; CASE_BASED: sub-questions; LONG_ANSWER: marking points; marks, provider, ...
ALTER TABLE questions ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3) progress tracking for generation jobs (teacher sees "34 of 50 ready")
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS requested_count INT NOT NULL DEFAULT 0;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS generated_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_questions_job ON questions (generation_job_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_source ON generation_jobs (source_id, created_at DESC);
