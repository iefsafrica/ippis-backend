-- Organisation structure: one way of linking to an MDA, and no silent cascades.
-- Safe to re-run. Run before deploying the code that reads company_id on these tables.
--
-- 1. designations, locations, company_policies and announcements were linked to
--    their MDA only by company_code, while departments use companies.id. Each now
--    also gets company_id, filled in from its code. company_code stays, because
--    the frontend still sends it; new rows get both.
-- 2. Deleting an MDA or a department used to cascade through the database and
--    silently delete departments, designations, locations, policies,
--    announcements and performance appraisers. Those foreign keys now RESTRICT,
--    so the database refuses such a delete instead (the API already refuses it
--    and explains why). Role assignments (user_roles, user_permissions) are not
--    changed here.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. company_id on the tables linked by code
-- ---------------------------------------------------------------------------

ALTER TABLE designations ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE company_policies ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS company_id INTEGER;

UPDATE designations t SET company_id = c.id FROM companies c
WHERE t.company_id IS NULL AND TRIM(c.company_code) = TRIM(t.company_code);
UPDATE locations t SET company_id = c.id FROM companies c
WHERE t.company_id IS NULL AND TRIM(c.company_code) = TRIM(t.company_code);
UPDATE company_policies t SET company_id = c.id FROM companies c
WHERE t.company_id IS NULL AND TRIM(c.company_code) = TRIM(t.company_code);
UPDATE announcements t SET company_id = c.id FROM companies c
WHERE t.company_id IS NULL AND TRIM(c.company_code) = TRIM(t.company_code);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['designations', 'locations', 'company_policies', 'announcements'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_company_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT',
        t, t || '_company_id_fkey'
      );
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (company_id)', t || '_company_id_idx', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Cascading deletes become RESTRICT
-- Every ON DELETE CASCADE foreign key from these tables to companies,
-- departments or designations is recreated, unchanged except for RESTRICT.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT con.conname, rel.relname AS table_name, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class ref ON ref.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND con.confdeltype = 'c'
      AND ns.nspname = current_schema()
      AND ref.relname IN ('companies', 'departments', 'designations')
      AND rel.relname IN ('departments', 'designations', 'locations', 'company_policies',
                          'announcements', 'performance_appraisers', 'performance_indicators')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.table_name, fk.conname);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.table_name, fk.conname,
                   replace(fk.definition, 'ON DELETE CASCADE', 'ON DELETE RESTRICT'));
  END LOOP;
END $$;

COMMIT;

-- Rows whose company_code matched no MDA keep company_id NULL. To list them:
--   SELECT 'designations' AS t, id, company_code FROM designations WHERE company_id IS NULL
--   UNION ALL SELECT 'locations', id, company_code FROM locations WHERE company_id IS NULL
--   UNION ALL SELECT 'company_policies', id, company_code FROM company_policies WHERE company_id IS NULL
--   UNION ALL SELECT 'announcements', id, company_code FROM announcements WHERE company_id IS NULL;
