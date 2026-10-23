-- Approvals, registration links, per-MDA modules, temporary access, access
-- reviews and MDA restructuring.
-- Safe to re-run. Adds tables, columns and constraints only; it changes no data.
-- Run AFTER database/transfer-migration.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Who decided a leave request (the signed-in approver, never a typed name)
-- ---------------------------------------------------------------------------
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS decided_by VARCHAR(255);
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS decided_by VARCHAR(255);
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- The private "continue your application" link: only a hash of the token is kept
-- ---------------------------------------------------------------------------
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS resume_token_hash VARCHAR(64);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS resume_token_expires_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Records of the shared modules belong to an MDA (and optionally a department).
-- Projects, finance, assets, recruitment, training, support tickets, clients and
-- invoices: a record without an MDA is visible to central users only until it is
-- assigned. Calendar events and the file manager: a record without an MDA is
-- shared with everyone. Knowledge base, careers CMS, tax types and asset
-- categories stay central reference data.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  -- Child records follow their parent and need no columns of their own:
  -- tasks and invoices (project), finance expenses, transfers, transactions,
  -- deposits and history (account), job candidates and interviews (job post)
  FOREACH t IN ARRAY ARRAY[
    'projects', 'clients', 'finance_accounts', 'finance_payees', 'finance_payers',
    'assets', 'job_posts', 'training_programs', 'support_tickets', 'hr_events',
    'file_manager_folders', 'file_manager_files'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS company_id INTEGER', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS department_id INTEGER', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_mda_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT', t, t || '_mda_fkey');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_mda_department_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (department_id, company_id) REFERENCES departments(id, company_id) ON DELETE RESTRICT', t, t || '_mda_department_fkey');
    END IF;
    -- A two-column key is not checked when either column is empty
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_department_needs_mda') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (department_id IS NULL OR company_id IS NOT NULL)', t, t || '_department_needs_mda');
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (company_id)', t || '_company_id_idx', t);
  END LOOP;
END $$;

COMMIT;
