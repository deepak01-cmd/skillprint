-- System IDs stay unique: every prefixed ID counter is kept ahead of the highest ID already stored
-- (rows loaded with fixed IDs, such as the sample data, can otherwise collide with generated ones).
CREATE OR REPLACE FUNCTION sync_id_sequences() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; mx bigint; cur bigint;
BEGIN
  FOR r IN SELECT c.table_name, substring(c.column_default from 'nextval\(''([a-z_]+)''') AS seq, substring(c.column_default from '^\(''([A-Z-]+)''') AS prefix
           FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.column_default LIKE '%nextval%' AND c.column_default LIKE '(''%'
  LOOP
    EXECUTE format('SELECT max(substring(id from %L)::bigint) FROM %I WHERE id ~ %L', '^' || r.prefix || '([0-9]+)$', r.table_name, '^' || r.prefix || '[0-9]+$') INTO mx;
    IF mx IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM %I', r.seq) INTO cur;
    IF cur < mx THEN PERFORM setval(r.seq, mx, true); END IF;
  END LOOP;
END $$;
SELECT sync_id_sequences();

-- learning catalogue entries get their own prefix (LR is used by library requests)
CREATE SEQUENCE IF NOT EXISTS seq_learning_ln START 1;
ALTER TABLE learning_resources ALTER COLUMN id SET DEFAULT 'LN' || lpad(nextval('seq_learning_ln')::text, 5, '0');

-- the company's own employee number, kept next to the system ID (unique within the organisation)
ALTER TABLE employees ADD COLUMN employee_code text CHECK (employee_code IS NULL OR length(employee_code) BETWEEN 1 AND 40);
CREATE UNIQUE INDEX ux_employee_code ON employees (org_id, lower(employee_code)) WHERE employee_code IS NOT NULL;

-- no duplicates
CREATE UNIQUE INDEX ux_learning_title ON learning_resources (coalesce(org_id, '*'), skill_id, lower(title)) WHERE status = 'Active';
CREATE UNIQUE INDEX ux_report_schedule ON report_schedules (org_id, owner_id, report, frequency, coalesce(department_id, '*'), format);
