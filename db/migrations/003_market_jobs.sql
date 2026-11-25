-- Module 14 (external skills intelligence): job-postings dataset, managed by the platform and shared
-- with every organisation as aggregates. Raw postings hold no personal data.

CREATE SEQUENCE seq_jobsource START 1;

CREATE TABLE job_sources (
  id            text PRIMARY KEY DEFAULT 'JS' || lpad(nextval('seq_jobsource')::text, 3, '0'),
  name          text NOT NULL,
  file_name     text,
  licence       text,                                   -- NULL = rights not confirmed: usable for structure, never as trend evidence
  rows_read     int NOT NULL DEFAULT 0,
  rows_imported int NOT NULL DEFAULT 0,
  period_from   date,
  period_to     date,
  imported_by   text NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  evidence_source_id text REFERENCES evidence_sources(id)
);

CREATE TABLE job_postings (
  id               bigserial PRIMARY KEY,
  source_id        text NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  company          text NOT NULL,
  raw_title        text NOT NULL,
  normalized_title text NOT NULL,
  seniority        text,
  location         text,
  country          text,
  department       text,
  industry         text,
  experience_level text,
  posted_date      date,
  description      text NOT NULL DEFAULT '',
  skill_ids        text[] NOT NULL DEFAULT '{}',
  candidate_terms  text[] NOT NULL DEFAULT '{}',
  content_hash     text NOT NULL,
  UNIQUE (source_id, content_hash)
);
CREATE INDEX ix_postings_title ON job_postings (normalized_title);
CREATE INDEX ix_postings_title_trgm ON job_postings USING gin (normalized_title gin_trgm_ops);
CREATE INDEX ix_postings_skills ON job_postings USING gin (skill_ids);

-- Refreshed after each import
CREATE TABLE job_title_clusters (
  normalized_title text PRIMARY KEY,
  display_title    text NOT NULL,
  postings         int NOT NULL,
  companies        int NOT NULL,
  raw_variants     jsonb NOT NULL,       -- [{title, n}]
  departments      jsonb NOT NULL,       -- [{name, n}]
  seniority        jsonb NOT NULL,       -- [{level, n}]
  skill_profile    jsonb NOT NULL,       -- [{skill_id, name, share}]
  top_companies    jsonb NOT NULL,
  refreshed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cluster_trgm ON job_title_clusters USING gin (normalized_title gin_trgm_ops);

CREATE TABLE job_skill_stats (
  skill_id   text PRIMARY KEY REFERENCES skills(id),
  postings   int NOT NULL,
  share      numeric(6,4) NOT NULL,
  companies  int NOT NULL,
  by_industry jsonb NOT NULL,
  top_titles jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_candidate_terms (
  term       text PRIMARY KEY,
  postings   int NOT NULL,
  companies  int NOT NULL,
  share      numeric(6,4) NOT NULL,
  top_titles jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'Candidate' CHECK (status IN ('Candidate','Added','Ignored')),
  skill_id   text REFERENCES skills(id),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE role_templates ADD COLUMN cluster_title text;
ALTER TABLE role_templates ADD COLUMN postings int;
