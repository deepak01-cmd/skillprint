-- Role & Skill Intelligence Platform: schema v3.0
-- Every organisation-owned table carries org_id (PRD 29.4). Role-skill mapping rules follow
-- the Developer Guide section 3: Pixel ID, lifecycle constraints, v_framework view, crosswalk, append-only audit.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- sequences for readable identifiers ----------
CREATE SEQUENCE seq_org START 100;
CREATE SEQUENCE seq_user START 1000;
CREATE SEQUENCE seq_dept START 100;
CREATE SEQUENCE seq_family START 100;
CREATE SEQUENCE seq_level START 100;
CREATE SEQUENCE seq_role START 100;     -- R### (platform-wide, so Pixel IDs are globally unique; PRD 37 open decision)
CREATE SEQUENCE seq_skill START 100;    -- S###
CREATE SEQUENCE seq_employee START 1000;
CREATE SEQUENCE seq_change START 1;
CREATE SEQUENCE seq_assessment START 1;
CREATE SEQUENCE seq_plan START 1;
CREATE SEQUENCE seq_activity START 1;
CREATE SEQUENCE seq_path START 1;
CREATE SEQUENCE seq_aspiration START 1;
CREATE SEQUENCE seq_wplan START 1;
CREATE SEQUENCE seq_assumption START 1;
CREATE SEQUENCE seq_evidence START 1;
CREATE SEQUENCE seq_source START 1;
CREATE SEQUENCE seq_suggestion START 1;
CREATE SEQUENCE seq_empevidence START 1;

-- ---------- Module 1: organisations ----------
CREATE TABLE organisations (
  id          text PRIMARY KEY DEFAULT 'C' || lpad(nextval('seq_org')::text, 3, '0'),
  name        text NOT NULL UNIQUE,
  industry    text NOT NULL,
  domain      text,
  status      text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Suspended')),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id          text PRIMARY KEY DEFAULT 'D' || lpad(nextval('seq_dept')::text, 3, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  name        text NOT NULL,
  parent_id   text REFERENCES departments(id),
  location    text,
  status      text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE users (
  id            text PRIMARY KEY DEFAULT 'U' || lpad(nextval('seq_user')::text, 4, '0'),
  org_id        text REFERENCES organisations(id),        -- null only for platform administrators
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('platform_admin','hr_admin','dept_head','manager','employee','expert')),
  department_id text REFERENCES departments(id),
  job_family_scope text[] NOT NULL DEFAULT '{}',           -- expert reviewers: assigned job families
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'platform_admin') = (org_id IS NULL))
);

-- ---------- Module 2: job architecture ----------
CREATE TABLE job_families (
  id          text PRIMARY KEY DEFAULT 'JF' || lpad(nextval('seq_family')::text, 3, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  name        text NOT NULL,
  description text,
  UNIQUE (org_id, name)
);

CREATE TABLE career_levels (
  id     text PRIMARY KEY DEFAULT 'CL' || lpad(nextval('seq_level')::text, 3, '0'),
  org_id text NOT NULL REFERENCES organisations(id),
  code   text NOT NULL,
  name   text NOT NULL,
  rank   int  NOT NULL,
  UNIQUE (org_id, rank), UNIQUE (org_id, code)
);

CREATE TABLE job_roles (
  id               text PRIMARY KEY DEFAULT 'R' || lpad(nextval('seq_role')::text, 3, '0'),
  org_id           text NOT NULL REFERENCES organisations(id),
  department_id    text NOT NULL REFERENCES departments(id),
  job_family_id    text REFERENCES job_families(id),
  career_level_id  text REFERENCES career_levels(id),
  title            text NOT NULL,
  alt_titles       text[] NOT NULL DEFAULT '{}',
  career_track     text NOT NULL DEFAULT 'Individual Contributor' CHECK (career_track IN ('Individual Contributor','Management','Technical Leadership')),
  summary          text NOT NULL DEFAULT '',
  responsibilities text[] NOT NULL DEFAULT '{}',
  outcomes         text[] NOT NULL DEFAULT '{}',
  experience       text,
  education        text,
  industry         text NOT NULL,
  status           text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','In Review','Published','Archived')),
  version          int  NOT NULL DEFAULT 1,
  review_date      date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_roles_org ON job_roles(org_id, status);

CREATE TABLE role_versions (
  role_id    text NOT NULL REFERENCES job_roles(id),
  version    int  NOT NULL,
  snapshot   jsonb NOT NULL,
  changed_by text NOT NULL,
  note       text,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, version)
);

-- ---------- Module 3: master skill library ----------
CREATE TABLE skills (
  id         text PRIMARY KEY DEFAULT 'S' || lpad(nextval('seq_skill')::text, 3, '0'),
  org_id     text REFERENCES organisations(id),              -- null = global skill managed by the platform
  name       text NOT NULL,
  definition text NOT NULL,
  category   text NOT NULL,
  type       text NOT NULL DEFAULT 'Technical / functional / industry',
  aliases    text[] NOT NULL DEFAULT '{}',
  parent_id  text REFERENCES skills(id),
  version    int NOT NULL DEFAULT 1,
  review_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_skill_name ON skills (coalesce(org_id, '*'), lower(name));
CREATE INDEX ix_skill_trgm ON skills USING gin (lower(name) gin_trgm_ops);

CREATE TABLE skill_relationships (
  skill_id   text NOT NULL REFERENCES skills(id),
  related_id text NOT NULL REFERENCES skills(id),
  PRIMARY KEY (skill_id, related_id)
);

-- ---------- Module 5: proficiency framework ----------
CREATE TABLE proficiency_levels (
  org_id     text NOT NULL REFERENCES organisations(id),
  level      smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  name       text NOT NULL,
  descriptor text NOT NULL,
  PRIMARY KEY (org_id, level)
);
CREATE TABLE skill_level_descriptors (
  org_id     text NOT NULL REFERENCES organisations(id),
  skill_id   text NOT NULL REFERENCES skills(id),
  level      smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  descriptor text NOT NULL,
  PRIMARY KEY (org_id, skill_id, level)
);

-- ---------- Module 4: role-skill mapping (Developer Guide 3.1, 3.2) ----------
CREATE TABLE role_skill_mapping (
  org_id                  text NOT NULL REFERENCES organisations(id),
  pixel_id                text NOT NULL,
  role_id                 text NOT NULL REFERENCES job_roles(id),
  skill_id                text NOT NULL REFERENCES skills(id),
  required_level          smallint NOT NULL CHECK (required_level BETWEEN 1 AND 5),
  requirement_type        text NOT NULL CHECK (requirement_type IN ('Mandatory','Preferred','Optional','Developmental','Legacy only')),
  importance              text NOT NULL CHECK (importance IN ('Critical','High','Medium','Low')),
  skill_trend             text NOT NULL CHECK (skill_trend IN ('Current','Emerging','Declining','Archived')),
  demand_direction        text NOT NULL DEFAULT 'Stable' CHECK (demand_direction IN ('Increasing','Stable','Decreasing')),
  observation_period      text,
  trend_rationale         text NOT NULL DEFAULT '',
  confidence_score        numeric(3,2),
  evidence_status         text NOT NULL DEFAULT 'Unverified' CHECK (evidence_status IN ('Unverified','Verified')),
  explanation             text NOT NULL DEFAULT '',
  approval_status         text NOT NULL DEFAULT 'Draft' CHECK (approval_status IN ('Draft','In Review','Changes Requested','Published')),
  lifecycle_status        text NOT NULL DEFAULT 'Active' CHECK (lifecycle_status IN ('Active','Archived')),
  archive_reason_category text CHECK (archive_reason_category IN ('End of life','Replaced by successor','Regulation change','No demand')),
  archive_reason          text,
  archived_on             date,
  archived_by             text,
  last_required_level     smallint,
  last_requirement_type   text,
  last_importance         text,
  review_flag             boolean NOT NULL DEFAULT false,
  version                 int NOT NULL DEFAULT 1,
  created_by              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pixel_id),
  CONSTRAINT uq_role_skill UNIQUE (org_id, role_id, skill_id),
  CONSTRAINT ck_pixel_format CHECK (pixel_id ~ '^PX-R[0-9]{3,}-S[0-9]{3,}$'),
  CONSTRAINT ck_pixel_matches CHECK (pixel_id = 'PX-' || role_id || '-' || skill_id),
  CONSTRAINT ck_archived_consistent CHECK ((lifecycle_status = 'Archived') = (skill_trend = 'Archived')),
  CONSTRAINT ck_archived_fields CHECK (lifecycle_status = 'Active'
    OR (archive_reason IS NOT NULL AND archive_reason_category IS NOT NULL AND archived_on IS NOT NULL AND requirement_type = 'Legacy only')),
  CONSTRAINT ck_legacy_only_archived CHECK (requirement_type <> 'Legacy only' OR lifecycle_status = 'Archived'),
  CONSTRAINT ck_archive_published CHECK (lifecycle_status = 'Active' OR approval_status = 'Published')
);
CREATE INDEX ix_mapping_role_status ON role_skill_mapping (org_id, role_id, lifecycle_status);
CREATE INDEX ix_mapping_skill ON role_skill_mapping (org_id, skill_id);

-- Pixel ID can never change once written (PX-03)
CREATE FUNCTION forbid_pixel_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pixel_id <> OLD.pixel_id OR NEW.role_id <> OLD.role_id OR NEW.skill_id <> OLD.skill_id OR NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'Pixel ID, role and skill of a mapping are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pixel_immutable BEFORE UPDATE ON role_skill_mapping FOR EACH ROW EXECUTE FUNCTION forbid_pixel_change();

-- The one active-only source (Developer Guide rule 5). Every default read goes through this view.
CREATE VIEW v_framework AS
  SELECT * FROM role_skill_mapping WHERE lifecycle_status = 'Active' AND approval_status = 'Published';

CREATE TABLE pixel_id_crosswalk (
  old_role_skill_id text PRIMARY KEY,
  old_framework_id  text NOT NULL,
  org_id            text NOT NULL REFERENCES organisations(id),
  pixel_id          text NOT NULL,
  FOREIGN KEY (org_id, pixel_id) REFERENCES role_skill_mapping(org_id, pixel_id)
);

-- ---------- append-only logs ----------
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;

CREATE TABLE archive_audit_log (
  id              bigserial PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organisations(id),
  pixel_id        text NOT NULL,
  action          text NOT NULL CHECK (action IN ('archive','restore','import_archived')),
  actor           text NOT NULL,
  reason_category text,
  reason          text,
  prior_trend     text,
  prior_values    jsonb,
  change_id       text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_archive_log_ro BEFORE UPDATE OR DELETE ON archive_audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      text REFERENCES organisations(id),
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  actor_id    text,
  actor_name  text NOT NULL,
  before      jsonb,
  after       jsonb,
  reason      text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_org ON audit_log(org_id, at DESC);
CREATE TRIGGER trg_audit_ro BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- Module 6: governance ----------
CREATE TABLE change_requests (
  id           text PRIMARY KEY DEFAULT 'CR-' || lpad(nextval('seq_change')::text, 5, '0'),
  org_id       text NOT NULL REFERENCES organisations(id),
  entity_type  text NOT NULL CHECK (entity_type IN ('mapping','role','career_path','skill')),
  entity_id    text NOT NULL,
  change_type  text NOT NULL CHECK (change_type IN ('publish','update','archive','restore')),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin       text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','system','evolution','mobility')),
  status       text NOT NULL DEFAULT 'In Review' CHECK (status IN ('In Review','Changes Requested','Published','Rejected','Withdrawn')),
  requested_by text NOT NULL,
  requested_by_name text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by   text,
  decided_at   timestamptz,
  comment      text
);
CREATE INDEX ix_change_org ON change_requests(org_id, status);

-- ---------- Module 7, 8: employees and skill profiles ----------
CREATE TABLE employees (
  id            text PRIMARY KEY DEFAULT 'E' || lpad(nextval('seq_employee')::text, 4, '0'),
  org_id        text NOT NULL REFERENCES organisations(id),
  user_id       text UNIQUE REFERENCES users(id),
  name          text NOT NULL,
  email         text NOT NULL,
  department_id text NOT NULL REFERENCES departments(id),
  role_id       text NOT NULL REFERENCES job_roles(id),
  manager_id    text REFERENCES employees(id),
  location      text,
  joining_date  date,
  status        text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  synthetic     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

-- Current level per source. History lives in assessment_items (never overwritten).
CREATE TABLE employee_skills (
  org_id      text NOT NULL REFERENCES organisations(id),
  employee_id text NOT NULL REFERENCES employees(id),
  skill_id    text NOT NULL REFERENCES skills(id),
  source      text NOT NULL CHECK (source IN ('self','manager','validated')),
  level       smallint NOT NULL CHECK (level BETWEEN 0 AND 5),
  assessed_by text,
  assessed_on date NOT NULL DEFAULT current_date,
  PRIMARY KEY (employee_id, skill_id, source)
);

CREATE TABLE employee_evidence (
  id          text PRIMARY KEY DEFAULT 'EV' || lpad(nextval('seq_empevidence')::text, 5, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  employee_id text NOT NULL REFERENCES employees(id),
  skill_id    text NOT NULL REFERENCES skills(id),
  type        text NOT NULL CHECK (type IN ('Project','Repository','Certification','Assessment result','Work sample','Manager feedback','Training completion')),
  title       text NOT NULL,
  link        text,
  evidence_date date NOT NULL DEFAULT current_date,
  validation_status text NOT NULL DEFAULT 'Pending' CHECK (validation_status IN ('Pending','Validated','Rejected','Expired')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Module 9: assessments ----------
CREATE TABLE assessments (
  id          text PRIMARY KEY DEFAULT 'AS' || lpad(nextval('seq_assessment')::text, 5, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  employee_id text NOT NULL REFERENCES employees(id),
  method      text NOT NULL CHECK (method IN ('Self-assessment','Manager assessment','Technical quiz','Practical assignment','Project evaluation','Peer assessment','Certification evidence','Structured interview','Work sample')),
  status      text NOT NULL DEFAULT 'Assigned' CHECK (status IN ('Assigned','Submitted','Reviewed','Closed')),
  assigned_by text NOT NULL,
  assessor_id text REFERENCES users(id),
  due_date    date,
  notice      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at timestamptz
);
CREATE TABLE assessment_items (
  assessment_id  text NOT NULL REFERENCES assessments(id),
  skill_id       text NOT NULL REFERENCES skills(id),
  self_level     smallint CHECK (self_level BETWEEN 0 AND 5),
  self_evidence  text,
  assessed_level smallint CHECK (assessed_level BETWEEN 0 AND 5),
  score          numeric(5,2),
  feedback       text,
  PRIMARY KEY (assessment_id, skill_id)
);

-- ---------- Module 11: development ----------
CREATE TABLE development_plans (
  id          text PRIMARY KEY DEFAULT 'DP' || lpad(nextval('seq_plan')::text, 5, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  employee_id text NOT NULL REFERENCES employees(id),
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Archived')),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE development_activities (
  id            text PRIMARY KEY DEFAULT 'DA' || lpad(nextval('seq_activity')::text, 5, '0'),
  plan_id       text NOT NULL REFERENCES development_plans(id),
  skill_id      text NOT NULL REFERENCES skills(id),
  title         text NOT NULL,
  type          text NOT NULL CHECK (type IN ('Training course','Practical project','Workplace assignment','Mentoring','Job shadowing','Certification','Workshop','Reading material','Peer learning')),
  current_level smallint,
  target_level  smallint,
  description   text NOT NULL DEFAULT '',
  resource      text,
  mentor        text,
  due_date      date,
  status        text NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started','In progress','Submitted','Done')),
  evidence      text,
  feedback      text,
  source        text NOT NULL DEFAULT 'gap' CHECK (source IN ('gap','readiness','future','manual')),
  flag          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Module 12: career mobility ----------
CREATE TABLE career_paths (
  id                 text PRIMARY KEY DEFAULT 'CP' || lpad(nextval('seq_path')::text, 4, '0'),
  org_id             text NOT NULL REFERENCES organisations(id),
  from_role_id       text NOT NULL REFERENCES job_roles(id),
  to_role_id         text NOT NULL REFERENCES job_roles(id),
  movement_type      text NOT NULL CHECK (movement_type IN ('Vertical','Vertical (track change)','Vertical (skip-level)','Lateral','Cross-functional')),
  typical_months     int,
  extra_requirements text,
  approval_required  boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','In Review','Published','Archived')),
  version            int NOT NULL DEFAULT 1,
  review_flag        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, from_role_id, to_role_id),
  CHECK (from_role_id <> to_role_id)
);
CREATE TABLE aspirations (
  id                  text PRIMARY KEY DEFAULT 'ASP' || lpad(nextval('seq_aspiration')::text, 4, '0'),
  org_id              text NOT NULL REFERENCES organisations(id),
  employee_id         text NOT NULL REFERENCES employees(id),
  target_role_id      text NOT NULL REFERENCES job_roles(id),
  priority            text NOT NULL CHECK (priority IN ('Primary','Secondary')),
  shared_with_manager boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, priority), UNIQUE (employee_id, target_role_id)
);
CREATE TABLE readiness_snapshots (
  id            bigserial PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organisations(id),
  employee_id   text NOT NULL REFERENCES employees(id),
  target_role_id text NOT NULL REFERENCES job_roles(id),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  result        jsonb NOT NULL,
  assumption_set_id text
);
CREATE TRIGGER trg_readiness_ro BEFORE UPDATE OR DELETE ON readiness_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- Module 17: workforce planning ----------
CREATE TABLE assumption_sets (
  id         text PRIMARY KEY DEFAULT 'AS-' || lpad(nextval('seq_assumption')::text, 3, '0'),
  org_id     text NOT NULL REFERENCES organisations(id),
  version    int NOT NULL,
  status     text NOT NULL DEFAULT 'Published' CHECK (status IN ('Draft','Published','Archived')),
  data       jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, version)
);
CREATE TABLE workforce_plans (
  id                text PRIMARY KEY DEFAULT 'WP' || lpad(nextval('seq_wplan')::text, 4, '0'),
  org_id            text NOT NULL REFERENCES organisations(id),
  name              text NOT NULL,
  horizon_months    int NOT NULL DEFAULT 12 CHECK (horizon_months > 0),
  status            text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Approved','Archived')),
  owner_id          text NOT NULL,
  assumption_set_id text NOT NULL REFERENCES assumption_sets(id),
  snapshot          jsonb,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workforce_plan_roles (
  plan_id           text NOT NULL REFERENCES workforce_plans(id) ON DELETE CASCADE,
  role_id           text NOT NULL REFERENCES job_roles(id),
  attrition_rate    numeric(5,4) NOT NULL DEFAULT 0.10 CHECK (attrition_rate BETWEEN 0 AND 1),
  planned_headcount int NOT NULL CHECK (planned_headcount >= 0),
  PRIMARY KEY (plan_id, role_id)
);
CREATE TABLE workforce_plan_skills (
  plan_id           text NOT NULL REFERENCES workforce_plans(id) ON DELETE CASCADE,
  skill_id          text NOT NULL REFERENCES skills(id),
  growth_adjustment numeric(5,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, skill_id)
);

-- ---------- Module 18: evolution (lean) ----------
CREATE TABLE evidence_sources (
  id          text PRIMARY KEY DEFAULT 'SRC' || lpad(nextval('seq_source')::text, 3, '0'),
  org_id      text REFERENCES organisations(id),   -- null = shared source managed by the platform
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('Company data','Public framework','Outlook report','Job-posting dataset','Technology signal','Expert review')),
  licence     text NOT NULL CHECK (length(trim(licence)) > 0),   -- UC-41: no licence note, no use
  url         text,
  reliability text NOT NULL DEFAULT 'Medium' CHECK (reliability IN ('High','Medium','Low')),
  refresh_frequency text NOT NULL DEFAULT 'Quarterly'
);
CREATE TABLE evidence_items (
  id          text PRIMARY KEY DEFAULT 'EI' || lpad(nextval('seq_evidence')::text, 5, '0'),
  org_id      text NOT NULL REFERENCES organisations(id),
  source_id   text NOT NULL REFERENCES evidence_sources(id),
  skill_id    text NOT NULL REFERENCES skills(id),
  industry    text,
  signal_type text NOT NULL CHECK (signal_type IN ('external_demand','expert_rating','internal_demand','automation_exposure')),
  value       numeric(3,2) NOT NULL CHECK (value BETWEEN -1 AND 1),
  summary     text NOT NULL,
  evidence_date date NOT NULL,
  link        text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evolution_suggestions (
  id            text PRIMARY KEY DEFAULT 'ES' || lpad(nextval('seq_suggestion')::text, 4, '0'),
  org_id        text NOT NULL REFERENCES organisations(id),
  subject_type  text NOT NULL CHECK (subject_type IN ('mapping','skill','role')),
  subject_id    text NOT NULL,                       -- Pixel ID for mapping suggestions (PX-07)
  suggestion_type text NOT NULL CHECK (suggestion_type IN ('archive','raise_level','lower_level','add_skill')),
  status        text NOT NULL DEFAULT 'Suggested' CHECK (status IN ('Suggested','In expert review','Accepted','Edited and accepted','Deferred','Rejected','Needs review')),
  rationale     text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence    text NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  origin        text NOT NULL DEFAULT 'system',
  decided_by    text,
  decision_reason text,
  draft_change_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, subject_id, suggestion_type)
);
CREATE TABLE expert_reviews (
  suggestion_id text NOT NULL REFERENCES evolution_suggestions(id),
  reviewer_id   text NOT NULL REFERENCES users(id),
  verdict       text NOT NULL CHECK (verdict IN ('Agree','Change','Disagree')),
  comment       text,
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (suggestion_id, reviewer_id)
);
