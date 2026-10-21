-- Schema extension for User Management & Security
BEGIN;

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS staff_id VARCHAR(50);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS mda_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS scope_level VARCHAR(30) DEFAULT 'assigned_mda';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create index on staff_id for fast duplicate checks and lookups
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_staff_id_key ON admin_users (staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_users_mda_id_idx ON admin_users (mda_id);
CREATE INDEX IF NOT EXISTS admin_users_department_id_idx ON admin_users (department_id);

-- Ensure default superadmin has staff_id
UPDATE admin_users SET staff_id = 'IPPIS-HQ-001' WHERE id = 1 AND staff_id IS NULL;

-- Ensure standard initial MDAs exist in companies if not already present
INSERT INTO companies (name, company_code, status, created_at)
SELECT 'Federal Ministry of Finance', 'FMF', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE company_code = 'FMF' OR name = 'Federal Ministry of Finance');

INSERT INTO companies (name, company_code, status, created_at)
SELECT 'Office of the Head of the Civil Service (OHCSF)', 'OHCSF', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE company_code = 'OHCSF' OR name = 'Office of the Head of the Civil Service (OHCSF)');

INSERT INTO companies (name, company_code, status, created_at)
SELECT 'Office of the Accountant General of the Federation', 'OAGF', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE company_code = 'OAGF' OR name = 'Office of the Accountant General of the Federation');

INSERT INTO companies (name, company_code, status, created_at)
SELECT 'Federal Ministry of Health', 'FMOH', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE company_code = 'FMOH' OR name = 'Federal Ministry of Health');

INSERT INTO companies (name, company_code, status, created_at)
SELECT 'Federal Ministry of Education', 'FMOE', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE company_code = 'FMOE' OR name = 'Federal Ministry of Education');

INSERT INTO companies (name, company_code, status, created_at)
SELECT 'Federal Ministry of Interior', 'FMI', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE company_code = 'FMI' OR name = 'Federal Ministry of Interior');

-- Seed key departments for these MDAs
INSERT INTO departments (company_id, name, status, created_at)
SELECT c.id, d.name, 'active', NOW()
FROM companies c
CROSS JOIN (
  VALUES 
    ('FMF', 'Revenue & Tax Policy'),
    ('FMF', 'Fiscal Accounts'),
    ('FMF', 'Budget Planning'),
    ('OHCSF', 'Establishments & Industrial Relations'),
    ('OHCSF', 'Public Service Reforms'),
    ('OHCSF', 'Employee Welfare'),
    ('OAGF', 'IPPIS Central Operations'),
    ('OAGF', 'Consolidated Accounts'),
    ('OAGF', 'Treasury Operations'),
    ('FMOH', 'Hospital Services'),
    ('FMOH', 'Public Health'),
    ('FMOE', 'Tertiary Education'),
    ('FMOE', 'Basic & Secondary Education'),
    ('FMI', 'Immigration & Border Service'),
    ('FMI', 'Civil Defence Affairs')
) AS d(company_code, name)
WHERE c.company_code = d.company_code
  AND NOT EXISTS (
    SELECT 1 FROM departments WHERE company_id = c.id AND name = d.name
  );

COMMIT;
