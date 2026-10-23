-- Runs automatically on first container start (postgres image executes
-- everything in /docker-entrypoint-initdb.d alphabetically).

CREATE EXTENSION IF NOT EXISTS vector;

-- Sanity check row so we can confirm the extension loaded via psql later:
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
