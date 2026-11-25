-- Level-change requests with evidence, reviewed by the manager (or HR).
CREATE SEQUENCE seq_level_request START 1;
CREATE TABLE level_requests (
  id              text PRIMARY KEY DEFAULT 'LQ' || lpad(nextval('seq_level_request')::text, 5, '0'),
  org_id          text NOT NULL REFERENCES organisations(id),
  employee_id     text NOT NULL REFERENCES employees(id),
  skill_id        text NOT NULL REFERENCES skills(id),
  current_level   smallint CHECK (current_level BETWEEN 0 AND 5),
  requested_level smallint NOT NULL CHECK (requested_level BETWEEN 0 AND 5),
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  status          text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','More info needed','Approved','Rejected','Withdrawn')),
  reviewer_id     text REFERENCES employees(id),           -- the manager when the request was made
  decided_by      text,
  decided_by_name text,
  decided_level   smallint CHECK (decided_level BETWEEN 0 AND 5),
  decision_note   text CHECK (length(decision_note) <= 2000),
  history         jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE UNIQUE INDEX ux_level_request_open ON level_requests (employee_id, skill_id) WHERE status IN ('Pending','More info needed');
CREATE INDEX ix_level_request_reviewer ON level_requests (reviewer_id, status);

CREATE SEQUENCE seq_request_evidence START 1;
CREATE TABLE level_request_evidence (
  id          text PRIMARY KEY DEFAULT 'RE' || lpad(nextval('seq_request_evidence')::text, 6, '0'),
  request_id  text NOT NULL REFERENCES level_requests(id),
  kind        text NOT NULL CHECK (kind IN ('file','link')),
  type        text NOT NULL CHECK (type IN ('Project','Repository','Certification','Assessment result','Work sample','Manager feedback','Training completion')),
  title       text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  url         text CHECK (url IS NULL OR url ~ '^https?://'),
  file_name   text,
  mime        text,
  size_bytes  int CHECK (size_bytes IS NULL OR size_bytes <= 5242880),
  data        bytea,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'link') = (url IS NOT NULL)), CHECK ((kind = 'file') = (data IS NOT NULL))
);
CREATE INDEX ix_request_evidence ON level_request_evidence (request_id);

-- Mentoring: an employee asks a colleague to mentor them in a skill.
CREATE SEQUENCE seq_mentoring START 1;
CREATE TABLE mentoring_requests (
  id            text PRIMARY KEY DEFAULT 'MR' || lpad(nextval('seq_mentoring')::text, 5, '0'),
  org_id        text NOT NULL REFERENCES organisations(id),
  mentee_id     text NOT NULL REFERENCES employees(id),
  mentor_id     text NOT NULL REFERENCES employees(id),
  skill_id      text NOT NULL REFERENCES skills(id),
  message       text NOT NULL DEFAULT '' CHECK (length(message) <= 1000),
  status        text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Accepted','Declined','Cancelled','Completed')),
  response_note text CHECK (length(response_note) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  completed_at  timestamptz,
  CHECK (mentee_id <> mentor_id)
);
CREATE UNIQUE INDEX ux_mentoring_open ON mentoring_requests (mentee_id, mentor_id, skill_id) WHERE status IN ('Requested','Accepted');
CREATE TABLE mentoring_sessions (
  id          bigserial PRIMARY KEY,
  request_id  text NOT NULL REFERENCES mentoring_requests(id),
  held_on     date NOT NULL,
  minutes     int CHECK (minutes IS NULL OR minutes BETWEEN 5 AND 600),
  notes       text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Succession planning for critical roles.
CREATE SEQUENCE seq_succession START 1;
CREATE TABLE succession_plans (
  id           text PRIMARY KEY DEFAULT 'SP' || lpad(nextval('seq_succession')::text, 4, '0'),
  org_id       text NOT NULL REFERENCES organisations(id),
  role_id      text NOT NULL REFERENCES job_roles(id),
  criticality  text NOT NULL DEFAULT 'High' CHECK (criticality IN ('Critical','High','Medium')),
  reason       text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  status       text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Archived')),
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_succession_role ON succession_plans (role_id) WHERE status = 'Active';
CREATE TABLE successors (
  plan_id      text NOT NULL REFERENCES succession_plans(id),
  employee_id  text NOT NULL REFERENCES employees(id),
  readiness    text NOT NULL CHECK (readiness IN ('Ready now','Ready in 1-2 years','Ready in 3+ years')),
  notes        text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  added_by     text NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, employee_id)
);

-- Reports: schedules and generated files.
CREATE SEQUENCE seq_report START 1;
CREATE TABLE report_schedules (
  id          text PRIMARY KEY DEFAULT 'RS' || lpad(nextval('seq_report')::text, 4, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  report      text NOT NULL CHECK (report IN ('skill_gaps','skills_inventory','learning','mobility','succession','access')),
  format      text NOT NULL DEFAULT 'xlsx' CHECK (format IN ('xlsx','csv')),
  frequency   text NOT NULL CHECK (frequency IN ('weekly','monthly')),
  department_id text REFERENCES departments(id),
  recipients  text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  owner_id    text NOT NULL REFERENCES users(id),
  owner_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE report_runs (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organisations(id),
  schedule_id text REFERENCES report_schedules(id),
  report      text NOT NULL,
  format      text NOT NULL,
  file_name   text NOT NULL,
  rows        int NOT NULL,
  data        bytea NOT NULL,
  delivered   text NOT NULL DEFAULT 'download',      -- download | emailed | email failed: reason
  run_by      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_report_runs ON report_runs (org_id, created_at DESC);

-- Who looked at whose personal data. Append-only.
CREATE TABLE access_log (
  id          bigserial PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organisations(id),
  actor_id    text NOT NULL,
  actor_name  text NOT NULL,
  actor_role  text NOT NULL,
  subject_id  text REFERENCES employees(id),
  resource    text NOT NULL,
  detail      text,
  ip          text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_access_subject ON access_log (subject_id, at DESC);
CREATE INDEX ix_access_org ON access_log (org_id, at DESC);
CREATE TRIGGER trg_access_log_ro BEFORE UPDATE OR DELETE ON access_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
