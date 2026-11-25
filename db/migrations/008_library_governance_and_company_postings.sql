-- 1. Skill lifecycle: retire (history kept) and merge (a duplicate folded into another skill); which automatic run added a skill.
ALTER TABLE skills ADD COLUMN status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Retired'));
ALTER TABLE skills ADD COLUMN retired_reason text;
ALTER TABLE skills ADD COLUMN retired_at timestamptz;
ALTER TABLE skills ADD COLUMN retired_by text;
ALTER TABLE skills ADD COLUMN merged_into text REFERENCES skills(id);
ALTER TABLE skills ADD COLUMN source_run text;
CREATE SEQUENCE seq_growth_run START 1;
CREATE TABLE skill_growth_runs (
  id        text PRIMARY KEY DEFAULT 'SG' || lpad(nextval('seq_growth_run')::text, 4, '0'),
  at        timestamptz NOT NULL DEFAULT now(),
  mode      text NOT NULL,               -- automatic, or approved proposals
  added     int NOT NULL DEFAULT 0,
  note      text
);

-- 2. Two-step approval: candidates can be proposed, then approved by a different person (platform admin or library reviewer).
ALTER TABLE users ADD COLUMN library_reviewer boolean NOT NULL DEFAULT false;
ALTER TABLE job_candidate_terms DROP CONSTRAINT IF EXISTS job_candidate_terms_status_check;
ALTER TABLE job_candidate_terms ADD CONSTRAINT job_candidate_terms_status_check CHECK (status IN ('Candidate','Proposed','Added','Ignored'));
ALTER TABLE job_candidate_terms ADD COLUMN proposal jsonb;
ALTER TABLE job_candidate_terms ADD COLUMN proposed_by text;
ALTER TABLE job_candidate_terms ADD COLUMN proposed_by_name text;
ALTER TABLE job_candidate_terms ADD COLUMN proposed_at timestamptz;
ALTER TABLE job_candidate_terms ADD COLUMN decided_by_name text;
INSERT INTO platform_settings (key, value) VALUES ('library_approval', '{"two_step": true}') ON CONFLICT (key) DO NOTHING;
UPDATE users SET library_reviewer = true WHERE email = 'expert@finedge.demo';

-- 3. Company job postings: a source with org_id belongs to that organisation only. Shared (platform) market figures
--    are computed from postings without an organisation; company figures from that company's own postings.
ALTER TABLE job_sources ADD COLUMN org_id text REFERENCES organisations(id);
ALTER TABLE job_postings ADD COLUMN org_id text REFERENCES organisations(id);
CREATE INDEX ix_postings_org ON job_postings (org_id);
CREATE VIEW global_postings AS SELECT * FROM job_postings WHERE org_id IS NULL;

CREATE TABLE org_title_clusters (
  org_id         text NOT NULL REFERENCES organisations(id),
  normalized_title text NOT NULL,
  display_title  text NOT NULL,
  postings       int NOT NULL,
  raw_variants   jsonb NOT NULL DEFAULT '[]',
  skill_profile  jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (org_id, normalized_title)
);
CREATE TABLE org_candidate_terms (
  org_id      text NOT NULL REFERENCES organisations(id),
  term        text NOT NULL,
  postings    int NOT NULL,
  share       numeric(6,4) NOT NULL,
  top_titles  jsonb NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'Candidate' CHECK (status IN ('Candidate','Added','Ignored')),
  skill_id    text REFERENCES skills(id),
  suggested_skill_id text REFERENCES skills(id),
  suggested_category text,
  PRIMARY KEY (org_id, term)
);
