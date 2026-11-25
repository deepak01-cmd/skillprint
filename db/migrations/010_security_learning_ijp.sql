-- Server-side sessions (revocable), login lockout, forced password change.
CREATE TABLE user_sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX ix_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;

ALTER TABLE users ADD COLUMN failed_logins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- Learning catalogue. org_id NULL = shared platform catalogue; skill_id NULL with category = applies to a whole category.
CREATE SEQUENCE seq_learning START 1;
CREATE TABLE learning_resources (
  id          text PRIMARY KEY DEFAULT 'LR' || lpad(nextval('seq_learning')::text, 5, '0'),
  org_id      text REFERENCES organisations(id),
  skill_id    text REFERENCES skills(id),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  provider    text,
  type        text NOT NULL CHECK (type IN ('Course','Video','Book','Article','Certification','Project','Mentoring','Workshop','Internal')),
  url         text CHECK (url IS NULL OR url ~ '^https?://'),
  level_from  int NOT NULL DEFAULT 0 CHECK (level_from BETWEEN 0 AND 5),
  level_to    int NOT NULL DEFAULT 5 CHECK (level_to BETWEEN 1 AND 5 AND level_to >= level_from),
  hours       numeric(6,1) CHECK (hours IS NULL OR hours > 0),
  cost        text NOT NULL DEFAULT 'Free' CHECK (cost IN ('Free','Paid','Company paid')),
  status      text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Retired')),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_learning_skill ON learning_resources (skill_id) WHERE status = 'Active';
CREATE INDEX ix_learning_org ON learning_resources (org_id);

ALTER TABLE development_activities ADD COLUMN resource_id text REFERENCES learning_resources(id);

-- Internal job postings (IJP) and applications.
CREATE SEQUENCE seq_ijp START 1;
CREATE TABLE internal_jobs (
  id            text PRIMARY KEY DEFAULT 'IJ' || lpad(nextval('seq_ijp')::text, 5, '0'),
  org_id        text NOT NULL REFERENCES organisations(id),
  role_id       text NOT NULL REFERENCES job_roles(id),
  department_id text NOT NULL REFERENCES departments(id),
  title         text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  location      text,
  work_mode     text NOT NULL DEFAULT 'Onsite' CHECK (work_mode IN ('Onsite','Hybrid','Remote')),
  openings      int NOT NULL DEFAULT 1 CHECK (openings BETWEEN 1 AND 500),
  description   text NOT NULL DEFAULT '',
  min_match     int NOT NULL DEFAULT 0 CHECK (min_match BETWEEN 0 AND 100),
  closes_on     date,
  status        text NOT NULL DEFAULT 'Open' CHECK (status IN ('Draft','Open','On hold','Closed')),
  posted_by     text,
  posted_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ijp_org ON internal_jobs (org_id, status);

CREATE SEQUENCE seq_application START 1;
CREATE TABLE job_applications (
  id           text PRIMARY KEY DEFAULT 'AP' || lpad(nextval('seq_application')::text, 6, '0'),
  org_id       text NOT NULL REFERENCES organisations(id),
  job_id       text NOT NULL REFERENCES internal_jobs(id),
  employee_id  text NOT NULL REFERENCES employees(id),
  status       text NOT NULL DEFAULT 'Applied' CHECK (status IN ('Applied','Screening','Interview','Offered','Hired','Not selected','Withdrawn')),
  match_pct    int NOT NULL CHECK (match_pct BETWEEN 0 AND 100),
  snapshot     jsonb NOT NULL,
  note         text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  history      jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_application_active ON job_applications (job_id, employee_id) WHERE status <> 'Withdrawn';
CREATE INDEX ix_application_emp ON job_applications (employee_id);
