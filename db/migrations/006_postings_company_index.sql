-- Re-scans read postings employer by employer; without this index each employer meant reading every posting.
CREATE INDEX IF NOT EXISTS ix_postings_company ON job_postings (company);
-- Platform-wide settings (for example automatic addition of strongly demanded skills from job postings).
CREATE TABLE IF NOT EXISTS platform_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
