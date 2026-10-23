-- =====================================================================
-- EduAI  V1  initial schema
-- Postgres 16 + pgvector. Flyway owns the schema (Hibernate = validate).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(150) NOT NULL,
    role          VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'STUDENT')),
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Ingestion: one "source" = one upload OR one typed topic
-- ---------------------------------------------------------------------
CREATE TABLE sources (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          VARCHAR(10)  NOT NULL CHECK (kind IN ('DOCUMENT', 'TOPIC')),
    title         VARCHAR(255) NOT NULL,
    topic_query   VARCHAR(500),                       -- set when kind = TOPIC
    status        VARCHAR(12)  NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
    error_message TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (kind <> 'TOPIC' OR topic_query IS NOT NULL)
);

-- Individual file or web page inside a source (this is what gets cited)
CREATE TABLE source_documents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID         NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    url          TEXT,                                -- web pages
    filename     VARCHAR(255),                        -- uploaded files
    title        VARCHAR(500),
    retrieved_at TIMESTAMPTZ  NOT NULL DEFAULT now(), -- scrape date / upload date
    content_hash VARCHAR(64),
    CHECK (url IS NOT NULL OR filename IS NOT NULL)
);

CREATE TABLE chunks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id          UUID        NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    source_document_id UUID        NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    chunk_index        INT         NOT NULL,
    content            TEXT        NOT NULL,
    token_count        INT,
    embedding          vector(384) NOT NULL,
    embedding_model    VARCHAR(100) NOT NULL DEFAULT 'sentence-transformers/all-MiniLM-L6-v2',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_document_id, chunk_index)
);

CREATE INDEX idx_chunks_source ON chunks(source_id);
CREATE INDEX idx_chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Async generation jobs (Kafka: request -> AI service -> result event)
-- ---------------------------------------------------------------------
CREATE TABLE generation_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     UUID        NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    requested_by  UUID        NOT NULL REFERENCES users(id),
    params        JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- counts per type/difficulty
    status        VARCHAR(12) NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- Questions: every question MUST be grounded + cited
-- ---------------------------------------------------------------------
CREATE TABLE questions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id             UUID         NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    generation_job_id     UUID         REFERENCES generation_jobs(id) ON DELETE SET NULL,
    created_by            UUID         NOT NULL REFERENCES users(id),
    type                  VARCHAR(12)  NOT NULL CHECK (type IN ('MCQ', 'SUBJECTIVE', 'TRUE_FALSE')),
    difficulty            VARCHAR(6)   NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    topic                 VARCHAR(200) NOT NULL,       -- drives weak-topic analytics
    question_text         TEXT         NOT NULL,
    correct_answer        TEXT,                        -- TRUE_FALSE: 'true'/'false'; SUBJECTIVE: model answer
    explanation           TEXT,
    status                VARCHAR(10)  NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED')),
    -- grounding / citation (NOT NULL = no ungrounded questions, enforced by the DB)
    source_chunk_id       UUID         NOT NULL REFERENCES chunks(id) ON DELETE RESTRICT,
    citation_ref          TEXT         NOT NULL,       -- URL or filename
    citation_retrieved_at TIMESTAMPTZ  NOT NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (type <> 'TRUE_FALSE' OR correct_answer IN ('true', 'false'))
);

CREATE INDEX idx_questions_source ON questions(source_id);
CREATE INDEX idx_questions_topic  ON questions(topic);

CREATE TABLE question_options (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID    NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    position    INT     NOT NULL,
    option_text TEXT    NOT NULL,
    is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (question_id, position)
);

-- exactly one correct option per MCQ
CREATE UNIQUE INDEX uq_one_correct_option
    ON question_options(question_id) WHERE is_correct;

-- ---------------------------------------------------------------------
-- Exams (question paper builder)
-- ---------------------------------------------------------------------
CREATE TABLE exams (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id       UUID         NOT NULL REFERENCES users(id),
    source_id        UUID         REFERENCES sources(id) ON DELETE SET NULL,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    duration_minutes INT          NOT NULL CHECK (duration_minutes > 0),
    status           VARCHAR(10)  NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
    starts_at        TIMESTAMPTZ,
    ends_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at     TIMESTAMPTZ
);

CREATE TABLE exam_questions (
    exam_id     UUID          NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_id UUID          NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
    position    INT           NOT NULL,
    marks       NUMERIC(5, 2) NOT NULL DEFAULT 1 CHECK (marks > 0),
    PRIMARY KEY (exam_id, question_id),
    UNIQUE (exam_id, position)
);

-- ---------------------------------------------------------------------
-- Attempts + answers (auto-evaluation of objective questions)
-- ---------------------------------------------------------------------
CREATE TABLE attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id      UUID        NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id   UUID        NOT NULL REFERENCES users(id),
    status       VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS'
                 CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'TERMINATED')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    score        NUMERIC(7, 2),
    max_score    NUMERIC(7, 2),
    UNIQUE (exam_id, student_id)
);

CREATE INDEX idx_attempts_student ON attempts(student_id);

CREATE TABLE answers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id         UUID        NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    question_id        UUID        NOT NULL REFERENCES questions(id),
    selected_option_id UUID        REFERENCES question_options(id),
    answer_text        TEXT,                       -- TRUE_FALSE / SUBJECTIVE
    is_correct         BOOLEAN,                    -- NULL until evaluated / not auto-gradable
    marks_awarded      NUMERIC(5, 2),
    answered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_id)
);

CREATE INDEX idx_answers_question ON answers(question_id);  -- weak-topic analytics

-- ---------------------------------------------------------------------
-- Proctoring events (written by a Kafka consumer, never directly by the API)
-- event_type validated in app code (FACE_MISSING, FACE_RETURNED,
-- TAB_SWITCH, WINDOW_BLUR, ...) so future detectors need no migration.
-- ---------------------------------------------------------------------
CREATE TABLE proctoring_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id  UUID         NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    event_type  VARCHAR(40)  NOT NULL,
    severity    VARCHAR(8)   NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    occurred_at TIMESTAMPTZ  NOT NULL,             -- client-side time
    received_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_proctoring_attempt_time ON proctoring_events(attempt_id, occurred_at);