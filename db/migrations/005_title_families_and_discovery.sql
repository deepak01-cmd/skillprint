-- Title families: words used in job titles, with how many employers use them. Words only one or two employers use
-- (team codes, internal names) are treated as noise when grouping titles.
CREATE TABLE job_title_vocab (
  token     text PRIMARY KEY,
  companies int NOT NULL,
  titles    int NOT NULL
);
-- Skill discovery: candidates found in posting text, with a suggested existing skill (for aliases) and category.
ALTER TABLE job_candidate_terms ADD COLUMN kind text NOT NULL DEFAULT 'listed' CHECK (kind IN ('listed','discovered'));
ALTER TABLE job_candidate_terms ADD COLUMN suggested_skill_id text REFERENCES skills(id);
ALTER TABLE job_candidate_terms ADD COLUMN suggested_category text;
ALTER TABLE job_candidate_terms ADD COLUMN example text;
CREATE INDEX IF NOT EXISTS ix_postings_raw_title ON job_postings (raw_title);
CREATE INDEX IF NOT EXISTS ix_postings_norm_title ON job_postings (normalized_title);
