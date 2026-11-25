-- Framework files uploaded by the platform administrator become role templates; skills that are still waiting for
-- library approval are kept by name and linked when approved.
ALTER TABLE role_templates ADD COLUMN pending_skills jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE role_templates ADD COLUMN updated_at timestamptz;
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_entity_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_entity_check CHECK (entity IN ('skills','roles','role_skills','job_descriptions','employees','departments','framework','ijp_jobs'));
