-- Role profiles drafted for titles that are not in the framework: by a local AI model when one is connected, otherwise
-- from the organisation's and the market's own data. Shown at once (marked as unreviewed) and reviewed by HR before
-- anything enters the framework. One draft per organisation and title; later searches reuse it.
CREATE SEQUENCE seq_ai_draft START 1;
CREATE TABLE ai_role_drafts (
  id            text PRIMARY KEY DEFAULT 'AD' || lpad(nextval('seq_ai_draft')::text, 5, '0'),
  org_id        text NOT NULL REFERENCES organisations(id),
  query         text NOT NULL,
  normalized    text NOT NULL,
  status        text NOT NULL DEFAULT 'Generating' CHECK (status IN ('Generating','Ready','Approved','Rejected','Failed')),
  method        text CHECK (method IN ('ai','rules')),
  provider      text,
  model         text,
  payload       jsonb,
  context       jsonb,
  error         text,
  queue_id      text REFERENCES role_resolution_queue(id),
  role_id       text REFERENCES job_roles(id),
  created_by    text,
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  generated_at  timestamptz,
  decided_by    text,
  decided_at    timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX ux_ai_draft_open ON ai_role_drafts (org_id, normalized) WHERE status IN ('Generating','Ready','Approved');
ALTER TABLE role_resolution_queue DROP CONSTRAINT IF EXISTS role_resolution_queue_resolution_check;
ALTER TABLE role_resolution_queue ADD CONSTRAINT role_resolution_queue_resolution_check CHECK (resolution IN ('mapped_existing','from_template','new_role','dismissed','from_ai_draft'));
