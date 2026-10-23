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

-- ---------------------------------------------------------------------------
-- One user may hold the same role in more than one MDA or department (needed
-- for temporary access to another MDA). Same as rbac-migration-2-multi-scope.sql.
-- ---------------------------------------------------------------------------
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_assignment_key
    ON user_roles (user_id, role_id, COALESCE(company_id, 0), COALESCE(department_id, 0));
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles (user_id);

-- ---------------------------------------------------------------------------
-- Temporary access to another MDA: requested by the user, approved by an access
-- administrator of that MDA, granted with an end date and removed by itself then
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_requests (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    scope_level VARCHAR(20) NOT NULL CHECK (scope_level IN ('mda', 'department')),
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    department_id INTEGER,
    reason TEXT NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'revoked')),
    decided_by VARCHAR(255),
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    grant_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT access_requests_department_fkey FOREIGN KEY (department_id, company_id)
        REFERENCES departments(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT access_requests_scope_check CHECK ((scope_level = 'department') = (department_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending
    ON access_requests (user_id, role_id, company_id, COALESCE(department_id, 0)) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Access reviews: an MDA's grants are reviewed (kept or revoked) periodically.
-- A review without an MDA covers the grants that apply across all MDAs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_reviews (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
    started_by VARCHAR(255) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at TIMESTAMPTZ NOT NULL,
    completed_by VARCHAR(255),
    completed_at TIMESTAMPTZ,
    note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS access_reviews_one_open
    ON access_reviews (COALESCE(company_id, 0)) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS access_review_items (
    id SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES access_reviews(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('role', 'permission')),
    role_id INTEGER,
    permission_id INTEGER,
    grant_key VARCHAR(255) NOT NULL,
    grant_name VARCHAR(255),
    scope_level VARCHAR(20) NOT NULL,
    company_id INTEGER,
    department_id INTEGER,
    expires_at TIMESTAMPTZ,
    assigned_by VARCHAR(255),
    assigned_at TIMESTAMPTZ,
    decision VARCHAR(20) CHECK (decision IN ('keep', 'revoke')),
    decided_by VARCHAR(255),
    decided_at TIMESTAMPTZ,
    note TEXT
);
CREATE INDEX IF NOT EXISTS access_review_items_review_idx ON access_review_items (review_id);

-- ---------------------------------------------------------------------------
-- MDA restructuring: an MDA merged into another keeps a pointer to it
-- ---------------------------------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS merged_into_company_id INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_merged_into_fkey') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_merged_into_fkey FOREIGN KEY (merged_into_company_id) REFERENCES companies(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Payroll runs: one MDA's payroll for a month, prepared and approved as a whole
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_runs (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    period CHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    payment_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved', 'rejected')),
    employee_count INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
    skipped JSONB,
    prepared_by VARCHAR(255) NOT NULL,
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by VARCHAR(255),
    decided_at TIMESTAMPTZ,
    decision_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_one_per_period
    ON payroll_runs (company_id, period) WHERE status <> 'rejected';
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payroll_run_id INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_run_fkey') THEN
    ALTER TABLE payroll ADD CONSTRAINT payroll_run_fkey FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS payroll_payroll_run_idx ON payroll (payroll_run_id);

COMMIT;
