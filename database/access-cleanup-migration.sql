-- Clears out access left over from before the role and permission catalogue.
-- Safe to re-run. Every grant it removes is written to the audit log first.
--
-- Roles without a key whose permissions have no keys either ("Admin",
-- "Super Admin", "SuperAdmin") grant nothing: assigning one looked as if it
-- gave access but did not. They are retired, so they can no longer be chosen,
-- and their assignments are removed.
-- Permissions without a key ("Approve Employee", "Create Payroll", "Update
-- User", ...) are never checked, so granting one did nothing. Their grants are
-- removed; the permission rows stay, and the permission list no longer shows them.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE legacy_roles ON COMMIT DROP AS
SELECT r.id, r.name
FROM roles r
WHERE (r.key IS NULL OR TRIM(r.key) = '')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = r.id AND p.key IS NOT NULL AND TRIM(p.key) <> ''
  );

INSERT INTO audit_logs (actor_id, actor_username, action, target_type, target_id, reason, details, created_at)
SELECT 'migration', 'access-cleanup-migration', 'access.role.revoked', 'user', ur.user_id,
       'Legacy role that grants no permissions',
       jsonb_build_object('role_id', ur.role_id, 'role', l.name, 'scope', ur.scope_level), NOW()
FROM user_roles ur JOIN legacy_roles l ON l.id = ur.role_id;

DELETE FROM user_roles WHERE role_id IN (SELECT id FROM legacy_roles);
UPDATE roles SET status = 'retired', updated_at = NOW()
WHERE id IN (SELECT id FROM legacy_roles) AND status <> 'retired';

CREATE TEMP TABLE legacy_permissions ON COMMIT DROP AS
SELECT id, name FROM permissions WHERE key IS NULL OR TRIM(key) = '';

INSERT INTO audit_logs (actor_id, actor_username, action, target_type, target_id, reason, details, created_at)
SELECT 'migration', 'access-cleanup-migration', 'access.permission.revoked', 'user', up.user_id,
       'Legacy permission without a key, never checked',
       jsonb_build_object('permission_id', up.permission_id, 'permission', l.name, 'scope', up.scope_level), NOW()
FROM user_permissions up JOIN legacy_permissions l ON l.id = up.permission_id;

DELETE FROM user_permissions WHERE permission_id IN (SELECT id FROM legacy_permissions);
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM legacy_permissions);

COMMIT;
