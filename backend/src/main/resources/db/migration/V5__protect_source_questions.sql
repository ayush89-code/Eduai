-- Step 6 follow-up: a source that still has generated questions must not be deletable.
-- V1 let a source delete silently cascade to every question made from it (even approved ones).
-- RESTRICT makes the database refuse instead; the app answers 409 "used by questions",
-- and the teacher first discards the questions (Discard button) if they really want to remove the source.
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'questions'::regclass AND contype = 'f' AND confrelid = 'sources'::regclass
    LOOP
        EXECUTE format('ALTER TABLE questions DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE questions
    ADD CONSTRAINT questions_source_id_fkey FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT;