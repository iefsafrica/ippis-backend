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

COMMIT;
