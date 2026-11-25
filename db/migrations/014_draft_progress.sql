-- progress of a draft being generated (percent and the step it is on)
ALTER TABLE ai_role_drafts ADD COLUMN progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE ai_role_drafts ADD COLUMN stage text;
