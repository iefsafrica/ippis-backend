-- Step 2 of the RBAC schema. Run ONLY after the code that no longer uses
-- ON CONFLICT (user_id, role_id) on user_roles is deployed.
-- Lets one user hold the same role in more than one MDA/department.
-- Safe to re-run.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_assignment_key
    ON user_roles (user_id, role_id, COALESCE(company_id, 0), COALESCE(department_id, 0));
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles (user_id);

COMMIT;
