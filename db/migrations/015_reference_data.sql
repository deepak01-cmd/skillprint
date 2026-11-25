-- Reference data from outside publishers (O*NET and other occupation / skill taxonomies).
-- Each source release is stored as delivered, next to the company's own framework, never merged into it.
-- A release is loaded as a Draft, checked, then published; publishing retires the previous release of the same dataset.

CREATE SEQUENCE IF NOT EXISTS seq_reference_rs START 1;
CREATE TABLE reference_sources (
  id           text PRIMARY KEY DEFAULT 'RS' || lpad(nextval('seq_reference_rs')::text, 4, '0'),
  publisher    text NOT NULL CHECK (length(trim(publisher)) BETWEEN 1 AND 120),
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  version      text CHECK (version IS NULL OR length(version) <= 60),
  released     date,
  licence      text CHECK (licence IS NULL OR length(licence) <= 400),       -- required before publishing
  attribution  text CHECK (attribution IS NULL OR length(attribution) <= 2000), -- shown wherever the data is shown
  url          text CHECK (url IS NULL OR url ~ '^https?://'),
  status       text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Loading', 'Active', 'Retired')),
  files        jsonb NOT NULL DEFAULT '[]',
  counts       jsonb NOT NULL DEFAULT '{}',
  created_by   text, created_at timestamptz NOT NULL DEFAULT now(),
  published_by text, published_at timestamptz
);
CREATE UNIQUE INDEX ux_reference_active ON reference_sources (lower(publisher), lower(name)) WHERE status = 'Active';

-- occupations (O*NET-SOC code, or the code a source uses)
CREATE TABLE ref_occupations (
  source_id   text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code        text NOT NULL,
  title       text NOT NULL,
  description text,
  PRIMARY KEY (source_id, code)
);
-- every title an occupation is known by (its own title, alternate and reported titles), for matching job roles
CREATE TABLE ref_titles (
  source_id text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code      text NOT NULL,
  title     text NOT NULL,
  kind      text NOT NULL DEFAULT 'title' CHECK (kind IN ('title', 'alternate', 'reported')),
  PRIMARY KEY (source_id, code, title)
);
CREATE INDEX ix_ref_titles_trgm ON ref_titles USING gin (lower(title) gin_trgm_ops);
CREATE INDEX ix_ref_titles_code ON ref_titles (code);

-- descriptors: skills, knowledge, abilities, work styles, work context, work activities, interests, technologies
CREATE TABLE ref_elements (
  source_id   text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  element_id  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('skill', 'knowledge', 'ability', 'work_style', 'work_context', 'work_activity', 'interest', 'technology', 'other')),
  name        text NOT NULL,
  description text,
  category    text,
  PRIMARY KEY (source_id, element_id)
);
CREATE INDEX ix_ref_elements_name ON ref_elements (lower(name));

-- ratings of descriptors for occupations (O*NET scales: IM importance 1-5, LV level 0-7, WI impact, DR rank, CX/CT context)
CREATE TABLE ref_ratings (
  source_id  text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code       text NOT NULL,
  element_id text NOT NULL,
  scale      text NOT NULL,
  value      numeric NOT NULL,
  n          int,
  rated_on   text,
  domain     text,
  PRIMARY KEY (source_id, code, element_id, scale)
);
CREATE INDEX ix_ref_ratings_code ON ref_ratings (code);

-- category labels of a scale (for example Work Context frequency: 1 = Never ... 5 = Every day)
CREATE TABLE ref_categories (
  source_id  text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  element_id text NOT NULL,
  scale      text NOT NULL,
  category   int NOT NULL,
  label      text NOT NULL,
  PRIMARY KEY (source_id, element_id, scale, category)
);

-- links between descriptors (for example a work style and the work activities it supports)
CREATE TABLE ref_element_links (
  source_id text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  from_id   text NOT NULL,
  to_id     text NOT NULL,
  PRIMARY KEY (source_id, from_id, to_id)
);

-- labour-market outlook flags for occupations (O*NET Bright Outlook: Rapid Growth, Numerous Job Openings, New & Emerging)
CREATE TABLE ref_outlook_flags (
  source_id text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code      text NOT NULL,
  flag      text NOT NULL,
  PRIMARY KEY (source_id, code, flag)
);

-- technologies used in occupations, with demand flags (O*NET Technology Skills: Hot Technology, In Demand)
CREATE TABLE ref_technologies (
  source_id text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code      text NOT NULL,
  example   text NOT NULL,
  commodity text,
  hot       boolean NOT NULL DEFAULT false,
  in_demand boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source_id, code, example)
);
CREATE INDEX ix_ref_tech_example ON ref_technologies (lower(example));

-- a descriptor or technology name matched to a skill in the shared library (recomputed when a source is loaded)
CREATE TABLE ref_skill_links (
  source_id text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  name      text NOT NULL,              -- lower-cased element name or technology example
  skill_id  text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, name)
);

-- a company's job role linked to a reference occupation: found automatically, confirmed or changed by HR
CREATE TABLE ref_role_links (
  role_id      text PRIMARY KEY REFERENCES job_roles(id) ON DELETE CASCADE,
  org_id       text NOT NULL,
  code         text,                    -- NULL with method 'none' = HR said no occupation fits
  score        numeric,
  method       text NOT NULL CHECK (method IN ('auto', 'confirmed', 'none')),
  confirmed_by text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ref_role_links_org ON ref_role_links (org_id);

-- tasks newly reported for occupations (O*NET Emerging Tasks): a sign of how the work is changing
CREATE TABLE ref_tasks (
  source_id text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code      text NOT NULL,
  task      text NOT NULL,
  category  text,
  reported  text,
  PRIMARY KEY (source_id, code, task)
);
-- related occupations (O*NET Related Occupations), for career moves
CREATE TABLE ref_related (
  source_id    text NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  code         text NOT NULL,
  related_code text NOT NULL,
  tier         text,
  rank         int,
  PRIMARY KEY (source_id, code, related_code)
);
