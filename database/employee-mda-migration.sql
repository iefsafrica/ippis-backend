-- Link employees to their MDA, department, designation and location.
-- Safe to re-run. Adds columns and constraints only; it changes no data.
-- Run AFTER database/organisation-links-migration.sql (designations and
-- locations need their company_id column first).
--
-- Until now an employee's ministry and department existed only as free text
-- (employment_info.organization, employment_info.department,
-- employees.department). Linking existing employees is done afterwards through
-- /api/admin/employees/mda-mapping, which reports how the text matches the
-- official MDA list and lets HR apply or correct the matches.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS designation_id INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS location_id INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mda_linked_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mda_linked_by VARCHAR(255);

-- What the applicant chose on the registration form, copied to the employee on approval
ALTER TABLE employment_info ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE employment_info ADD COLUMN IF NOT EXISTS department_id INTEGER;

-- (id, company_id) pairs, so a department, designation or location can only be
-- linked together with the MDA it belongs to
CREATE UNIQUE INDEX IF NOT EXISTS departments_id_company_key ON departments (id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS designations_id_company_key ON designations (id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS locations_id_company_key ON locations (id, company_id);

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('employees', 'employees_company_id_fkey',
       'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
      ('employees', 'employees_department_company_fkey',
       'FOREIGN KEY (department_id, company_id) REFERENCES departments(id, company_id) ON DELETE RESTRICT'),
      ('employees', 'employees_designation_company_fkey',
       'FOREIGN KEY (designation_id, company_id) REFERENCES designations(id, company_id) ON DELETE RESTRICT'),
      ('employees', 'employees_location_company_fkey',
       'FOREIGN KEY (location_id, company_id) REFERENCES locations(id, company_id) ON DELETE RESTRICT'),
      ('employment_info', 'employment_info_company_id_fkey',
       'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT'),
      ('employment_info', 'employment_info_department_company_fkey',
       'FOREIGN KEY (department_id, company_id) REFERENCES departments(id, company_id) ON DELETE RESTRICT'),
      -- A two-column key is not checked when either column is empty, so a
      -- department, designation or location must come with its MDA
      ('employees', 'employees_unit_needs_mda_check',
       'CHECK ((department_id IS NULL AND designation_id IS NULL AND location_id IS NULL) OR company_id IS NOT NULL)'),
      ('employment_info', 'employment_info_department_needs_mda_check',
       'CHECK (department_id IS NULL OR company_id IS NOT NULL)')
    ) AS t(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', c.table_name, c.constraint_name, c.definition);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS employees_company_id_idx ON employees (company_id);
CREATE INDEX IF NOT EXISTS employees_department_id_idx ON employees (department_id);

COMMIT;
