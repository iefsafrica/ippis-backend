-- Undoes rbac-migration.sql (and step 2 if it was run).
-- Removes the seeded catalogue, every role assignment made since, and the audit trail.
-- Roles and permissions that existed before the migration are kept.

BEGIN;

SET LOCAL lock_timeout = '5s';

DELETE FROM user_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key IS NOT NULL);
DELETE FROM user_roles;
DELETE FROM roles WHERE key IS NOT NULL;
DELETE FROM permissions WHERE key IS NOT NULL;

DROP TABLE IF EXISTS sod_rules;
DROP TABLE IF EXISTS audit_logs;

ALTER TABLE admin_users DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS sessions_valid_after;

ALTER TABLE user_permissions
    DROP COLUMN IF EXISTS scope_level, DROP COLUMN IF EXISTS company_id, DROP COLUMN IF EXISTS department_id,
    DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS assigned_by, DROP COLUMN IF EXISTS assigned_at,
    DROP COLUMN IF EXISTS reason;

DROP INDEX IF EXISTS user_roles_assignment_key;
DROP INDEX IF EXISTS user_roles_user_id_idx;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles
    DROP COLUMN IF EXISTS id, DROP COLUMN IF EXISTS scope_level, DROP COLUMN IF EXISTS company_id,
    DROP COLUMN IF EXISTS department_id, DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS assigned_by,
    DROP COLUMN IF EXISTS assigned_at, DROP COLUMN IF EXISTS reason;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);

ALTER TABLE roles
    DROP COLUMN IF EXISTS key, DROP COLUMN IF EXISTS is_system, DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS default_scope, DROP COLUMN IF EXISTS sod_exempt;

ALTER TABLE permissions
    DROP COLUMN IF EXISTS key, DROP COLUMN IF EXISTS module, DROP COLUMN IF EXISTS is_privileged,
    DROP COLUMN IF EXISTS is_system;

COMMIT;
