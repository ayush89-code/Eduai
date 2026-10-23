-- Step 4: the ingestion service stores the cleaned text of each source document here;
-- Step 5 reads it back to chunk + embed it.
ALTER TABLE source_documents ADD COLUMN raw_text   TEXT;
ALTER TABLE source_documents ADD COLUMN char_count INT;
