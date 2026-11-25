-- Indexes on job_postings that no query uses. Every write (imports, re-scans) had to maintain them; the two GIN indexes
-- are expensive, especially in the portable (WebAssembly) database. ix_postings_norm_title duplicates ix_postings_title.
DROP INDEX IF EXISTS ix_postings_title_trgm;
DROP INDEX IF EXISTS ix_postings_skills;
DROP INDEX IF EXISTS ix_postings_norm_title;
