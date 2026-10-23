-- Transfers that move people between departments and MDAs (ORG-05).
-- Safe to re-run. Adds columns and constraints only; it changes no data.
-- Run AFTER database/employee-mda-migration.sql.
--
-- Until now a transfer was free text that nothing acted on. A transfer now
-- names its destination by id, goes through pending -> approved -> completed
-- (or rejected / cancelled), and on completion moves the employee and removes
-- the access their admin account held for the unit they left. Existing text
-- transfers stay pending; set a destination on them before approving.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Where the employee was when the transfer was requested (a snapshot for the record)
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS from_company_id INTEGER;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS from_department_id INTEGER;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS from_designation_id INTEGER;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS from_location_id INTEGER;

-- Where the employee is going
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS to_company_id INTEGER;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS to_department_id INTEGER;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS to_designation_id INTEGER;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS to_location_id INTEGER;

-- Who did what
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS requested_by VARCHAR(255);
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(255);
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS completed_by VARCHAR(255);
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- The access removed or flagged for review when the transfer completed
ALTER TABLE employee_transfers ADD COLUMN IF NOT EXISTS access_changes JSONB;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('employee_transfers_to_company_fkey',
       'FOREIGN KEY (to_company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
      ('employee_transfers_to_department_company_fkey',
       'FOREIGN KEY (to_department_id, to_company_id) REFERENCES departments(id, company_id) ON DELETE RESTRICT'),
      ('employee_transfers_to_designation_company_fkey',
       'FOREIGN KEY (to_designation_id, to_company_id) REFERENCES designations(id, company_id) ON DELETE RESTRICT'),
      ('employee_transfers_to_location_company_fkey',
       'FOREIGN KEY (to_location_id, to_company_id) REFERENCES locations(id, company_id) ON DELETE RESTRICT'),
      -- A two-column key is not checked when either column is empty
      ('employee_transfers_to_unit_needs_mda_check',
       'CHECK ((to_department_id IS NULL AND to_designation_id IS NULL AND to_location_id IS NULL) OR to_company_id IS NOT NULL)'),
      -- NOT VALID: enforced for new and changed rows without failing on old free-text values
      ('employee_transfers_status_check',
       'CHECK (status IN (''pending'', ''approved'', ''completed'', ''rejected'', ''cancelled'')) NOT VALID')
    ) AS t(constraint_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.constraint_name) THEN
      EXECUTE format('ALTER TABLE employee_transfers ADD CONSTRAINT %I %s', c.constraint_name, c.definition);
    END IF;
  END LOOP;
END $$;

-- One open transfer per employee
CREATE UNIQUE INDEX IF NOT EXISTS employee_transfers_one_open
  ON employee_transfers (employee_id) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS employee_transfers_status_idx ON employee_transfers (status, effective_date);

COMMIT;
