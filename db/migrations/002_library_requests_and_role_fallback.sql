-- Master library update requests (PRD 7.5: "request a master library update") and
-- the role fallback: role templates plus a resolution queue so no unknown role title is dropped.

CREATE SEQUENCE seq_libreq START 1;
CREATE SEQUENCE seq_template START 1;
CREATE SEQUENCE seq_rolequeue START 1;

CREATE TABLE library_requests (
  id           text PRIMARY KEY DEFAULT 'LR' || lpad(nextval('seq_libreq')::text, 4, '0'),
  org_id       text NOT NULL REFERENCES organisations(id),
  skill_id     text REFERENCES skills(id),
  type         text NOT NULL CHECK (type IN ('alias','update','new_skill')),
  text         text NOT NULL,
  status       text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Approved','Rejected')),
  requested_by text NOT NULL,
  decided_by   text,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);

-- Platform-managed role templates: reusable starting profiles, never tenant data.
CREATE TABLE role_templates (
  id          text PRIMARY KEY DEFAULT 'RT' || lpad(nextval('seq_template')::text, 4, '0'),
  title       text NOT NULL,
  aliases     text[] NOT NULL DEFAULT '{}',
  job_family  text,
  industry    text,
  summary     text NOT NULL DEFAULT '',
  skills      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{skill_id, required_level, requirement_type, importance}]
  source      text NOT NULL,                        -- where the template came from (sample workbook, job-postings analysis, ...)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (title, industry)
);
CREATE INDEX ix_template_trgm ON role_templates USING gin (lower(title) gin_trgm_ops);

-- Every unknown role title lands here with suggestions until a person resolves it.
CREATE TABLE role_resolution_queue (
  id              text PRIMARY KEY DEFAULT 'RQ' || lpad(nextval('seq_rolequeue')::text, 4, '0'),
  org_id          text NOT NULL REFERENCES organisations(id),
  raw_title       text NOT NULL,
  normalized      text NOT NULL,
  department_id   text REFERENCES departments(id),
  source          text NOT NULL CHECK (source IN ('employee_import','employee_form','job_description','search','manual')),
  pending_records jsonb NOT NULL DEFAULT '[]'::jsonb,   -- e.g. employees waiting to be created once the role is resolved
  suggestions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrences     int NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Role drafted','Resolved','Dismissed')),
  resolution      text CHECK (resolution IN ('mapped_existing','from_template','new_role','dismissed')),
  resolved_role_id text REFERENCES job_roles(id),
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_rolequeue_open ON role_resolution_queue (org_id, normalized) WHERE status IN ('Open','Role drafted');
