-- Import centre: every bulk upload is previewed, then committed, and kept as a record with its row-level report.
CREATE SEQUENCE seq_import START 1;

CREATE TABLE import_jobs (
  id            text PRIMARY KEY DEFAULT 'IMP' || lpad(nextval('seq_import')::text, 5, '0'),
  org_id        text REFERENCES organisations(id),       -- null for platform-level imports
  entity        text NOT NULL CHECK (entity IN ('skills','roles','role_skills','job_descriptions','employees','departments')),
  file_name     text NOT NULL,
  mode          text NOT NULL DEFAULT 'draft' CHECK (mode IN ('draft','publish')),
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'Previewed' CHECK (status IN ('Previewed','Committed','Failed','Discarded')),
  total_rows    int NOT NULL DEFAULT 0,
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,       -- counts by planned / applied action
  rows          jsonb NOT NULL DEFAULT '[]'::jsonb,       -- parsed rows with their planned action and messages
  created_by    text NOT NULL,
  created_by_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  committed_at  timestamptz,
  error         text
);
CREATE INDEX ix_import_org ON import_jobs (org_id, created_at DESC);

-- Speed for large organisations
CREATE INDEX IF NOT EXISTS ix_employees_org_role ON employees (org_id, role_id) WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS ix_employees_manager ON employees (manager_id);
CREATE INDEX IF NOT EXISTS ix_employee_skills_emp ON employee_skills (employee_id);
CREATE INDEX IF NOT EXISTS ix_roles_title_trgm ON job_roles USING gin (lower(title) gin_trgm_ops);
