-- Role-based access control: schema upgrade + catalogue seed.
-- Additive and safe to re-run. Existing rows in roles/permissions are left alone;
-- rows without a key are simply never matched by the permission engine.

BEGIN;

-- ---------------------------------------------------------------------------
-- permissions: module.resource.action keys
-- ---------------------------------------------------------------------------
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS key VARCHAR(150);
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS module VARCHAR(50);
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_privileged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS permissions_key_key ON permissions (key);

-- ---------------------------------------------------------------------------
-- roles: templates, retirement, default scope
-- ---------------------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS key VARCHAR(60);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_scope VARCHAR(20) NOT NULL DEFAULT 'department';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS sod_exempt BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS roles_key_key ON roles (key);

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_status_check;
ALTER TABLE roles ADD CONSTRAINT roles_status_check CHECK (status IN ('active', 'retired'));
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_default_scope_check;
ALTER TABLE roles ADD CONSTRAINT roles_default_scope_check
    CHECK (default_scope IN ('global', 'mda', 'department', 'self'));

-- ---------------------------------------------------------------------------
-- user_roles: organisational scope, expiry, attribution
-- MDA = companies, department = departments.
-- The same role may be held in more than one MDA/department, so the key moves
-- from (user_id, role_id) to a surrogate id plus a per-scope unique index.
-- ---------------------------------------------------------------------------
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS scope_level VARCHAR(20) NOT NULL DEFAULT 'self';
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(50);
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_assignment_key
    ON user_roles (user_id, role_id, COALESCE(company_id, 0), COALESCE(department_id, 0));
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles (user_id);

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_scope_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_scope_check CHECK (
    (scope_level IN ('global', 'self') AND company_id IS NULL AND department_id IS NULL)
    OR (scope_level = 'mda' AND company_id IS NOT NULL AND department_id IS NULL)
    OR (scope_level = 'department' AND company_id IS NOT NULL AND department_id IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- user_permissions: direct grants carry the same scope fields
-- ---------------------------------------------------------------------------
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS scope_level VARCHAR(20) NOT NULL DEFAULT 'self';
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(50);
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_scope_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_scope_check CHECK (
    (scope_level IN ('global', 'self') AND company_id IS NULL AND department_id IS NULL)
    OR (scope_level = 'mda' AND company_id IS NOT NULL AND department_id IS NULL)
    OR (scope_level = 'department' AND company_id IS NOT NULL AND department_id IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- admin_users: lifecycle status and session revocation
-- is_active stays the bit that login checks; status says why.
-- ---------------------------------------------------------------------------
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ;
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_status_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_status_check
    CHECK (status IN ('active', 'suspended', 'deactivated'));
UPDATE admin_users SET status = 'deactivated' WHERE is_active = FALSE AND status = 'active';

-- ---------------------------------------------------------------------------
-- audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id VARCHAR(50),
    actor_username VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    reason TEXT,
    details JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id);

-- ---------------------------------------------------------------------------
-- separation of duties: pairs of permissions one user must not hold together
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sod_rules (
    id SERIAL PRIMARY KEY,
    permission_a VARCHAR(150) NOT NULL,
    permission_b VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (permission_a, permission_b)
);

INSERT INTO sod_rules (permission_a, permission_b, description) VALUES
('payroll.cycles.prepare', 'payroll.cycles.approve', 'Payroll must be prepared and approved by different people'),
('finance.records.manage', 'finance.records.approve', 'Financial entries must be raised and approved by different people'),
('access.roles.manage', 'access.privileged.grant', 'Creating roles is separate from granting privileged access')
ON CONFLICT (permission_a, permission_b) DO NOTHING;

-- ---------------------------------------------------------------------------
-- permission catalogue
-- ---------------------------------------------------------------------------
INSERT INTO permissions (key, module, resource, action, name, description, is_privileged, is_system) VALUES
('employees.records.view',        'employees',    'records',       'view',    'View employee records',          'View employee records', FALSE, TRUE),
('employees.records.create',      'employees',    'records',       'create',  'Create employee records',        'Add employee records, including bulk import', FALSE, TRUE),
('employees.records.update',      'employees',    'records',       'update',  'Update employee records',        'Edit employee records', FALSE, TRUE),
('employees.records.delete',      'employees',    'records',       'delete',  'Delete employee records',        'Remove employee records', FALSE, TRUE),
('employees.records.approve',     'employees',    'records',       'approve', 'Approve employee record changes', 'Approve or reject changes to employee records', FALSE, TRUE),
('employees.records.export',      'employees',    'records',       'export',  'Export employee records',        'Export employee records', FALSE, TRUE),
('employees.documents.view',      'employees',    'documents',     'view',    'View employee documents',        'View uploaded employee documents', FALSE, TRUE),
('employees.documents.verify',    'employees',    'documents',     'verify',  'Verify employee documents',      'Verify or reject uploaded documents', FALSE, TRUE),
('employees.registrations.view',  'employees',    'registrations', 'view',    'View pending registrations',     'View onboarding registrations', FALSE, TRUE),
('employees.registrations.approve','employees',   'registrations', 'approve', 'Approve registrations',          'Approve or reject onboarding registrations', FALSE, TRUE),
('corehr.records.view',           'corehr',       'records',       'view',    'View Core HR records',           'Promotions, awards, travel, transfers, resignations, complaints, warnings, terminations', FALSE, TRUE),
('corehr.records.manage',         'corehr',       'records',       'manage',  'Manage Core HR records',         'Create and edit Core HR records', FALSE, TRUE),
('corehr.records.approve',        'corehr',       'records',       'approve', 'Approve Core HR records',        'Approve or reject Core HR requests', FALSE, TRUE),
('performance.records.view',      'performance',  'records',       'view',    'View performance records',       'Indicators, appraisals, goals', FALSE, TRUE),
('performance.records.manage',    'performance',  'records',       'manage',  'Manage performance records',     'Create and edit performance records', FALSE, TRUE),
('organization.structure.view',   'organization', 'structure',     'view',    'View organisation structure',    'Companies, departments, locations, designations, policies, announcements', FALSE, TRUE),
('organization.structure.manage', 'organization', 'structure',     'manage',  'Manage organisation structure',  'Create and edit organisation structure', FALSE, TRUE),
('timesheets.attendance.view',    'timesheets',   'attendance',    'view',    'View attendance',                'Attendance, shifts and holidays', FALSE, TRUE),
('timesheets.attendance.manage',  'timesheets',   'attendance',    'manage',  'Manage attendance',              'Record and import attendance, shifts and holidays', FALSE, TRUE),
('timesheets.leaves.view',        'timesheets',   'leaves',        'view',    'View leave requests',            'View leave requests', FALSE, TRUE),
('timesheets.leaves.manage',      'timesheets',   'leaves',        'manage',  'Manage leave requests',          'Create and edit leave requests', FALSE, TRUE),
('timesheets.leaves.approve',     'timesheets',   'leaves',        'approve', 'Approve leave requests',         'Approve or reject leave requests', FALSE, TRUE),
('calendar.events.view',          'calendar',     'events',        'view',    'View HR calendar',               'Events and meetings', FALSE, TRUE),
('calendar.events.manage',        'calendar',     'events',        'manage',  'Manage HR calendar',             'Create and edit events and meetings', FALSE, TRUE),
('reports.hr.view',               'reports',      'hr',            'view',    'View HR reports',                'View HR reports', FALSE, TRUE),
('reports.hr.export',             'reports',      'hr',            'export',  'Export HR reports',              'Export HR reports', FALSE, TRUE),
('recruitment.records.view',      'recruitment',  'records',       'view',    'View recruitment',               'Jobs, candidates, interviews', FALSE, TRUE),
('recruitment.records.manage',    'recruitment',  'records',       'manage',  'Manage recruitment',             'Create and edit jobs, candidates, interviews', FALSE, TRUE),
('training.records.view',         'training',     'records',       'view',    'View training',                  'Trainings, trainers, training types', FALSE, TRUE),
('training.records.manage',       'training',     'records',       'manage',  'Manage training',                'Create and edit trainings', FALSE, TRUE),
('payroll.cycles.view',           'payroll',      'cycles',        'view',    'View payroll',                   'View payroll cycles and payments', FALSE, TRUE),
('payroll.cycles.prepare',        'payroll',      'cycles',        'prepare', 'Prepare payroll',                'Prepare payroll cycles', FALSE, TRUE),
('payroll.cycles.approve',        'payroll',      'cycles',        'approve', 'Approve payroll',                'Approve prepared payroll cycles', FALSE, TRUE),
('payroll.cycles.export',         'payroll',      'cycles',        'export',  'Export payroll',                 'Export payroll data', FALSE, TRUE),
('projects.records.view',         'projects',     'records',       'view',    'View projects',                  'Projects and tasks', FALSE, TRUE),
('projects.records.manage',       'projects',     'records',       'manage',  'Manage projects',                'Create and edit projects and tasks', FALSE, TRUE),
('projects.records.approve',      'projects',     'records',       'approve', 'Approve projects',               'Approve or reject projects', FALSE, TRUE),
('support.tickets.view',          'support',      'tickets',       'view',    'View support tickets',           'View support tickets', FALSE, TRUE),
('support.tickets.manage',        'support',      'tickets',       'manage',  'Manage support tickets',         'Create and edit support tickets', FALSE, TRUE),
('support.tickets.approve',       'support',      'tickets',       'approve', 'Approve support tickets',        'Approve or resolve support tickets', FALSE, TRUE),
('finance.records.view',          'finance',      'records',       'view',    'View finance',                   'Accounts, deposits, expenses, transfers, transactions', FALSE, TRUE),
('finance.records.manage',        'finance',      'records',       'manage',  'Manage finance',                 'Create and edit financial entries', FALSE, TRUE),
('finance.records.approve',       'finance',      'records',       'approve', 'Approve finance',                'Approve financial entries', FALSE, TRUE),
('finance.records.export',        'finance',      'records',       'export',  'Export finance',                 'Export financial data', FALSE, TRUE),
('assets.records.view',           'assets',       'records',       'view',    'View assets',                    'Assets and categories', FALSE, TRUE),
('assets.records.manage',         'assets',       'records',       'manage',  'Manage assets',                  'Create and edit assets', FALSE, TRUE),
('assets.records.approve',        'assets',       'records',       'approve', 'Approve assets',                 'Approve asset requests', FALSE, TRUE),
('files.records.view',            'files',        'records',       'view',    'View file manager',              'Files and folders', FALSE, TRUE),
('files.records.manage',          'files',        'records',       'manage',  'Manage file manager',            'Upload and edit files and folders', FALSE, TRUE),
('files.records.approve',         'files',        'records',       'approve', 'Approve files',                  'Approve uploaded files', FALSE, TRUE),
('users.accounts.view',           'users',        'accounts',      'view',    'View user accounts',             'View admin user accounts', FALSE, TRUE),
('users.accounts.manage',         'users',        'accounts',      'manage',  'Manage user accounts',           'Create, edit, suspend and deactivate user accounts', FALSE, TRUE),
('access.roles.view',             'access',       'roles',         'view',    'View roles',                     'View roles and role assignments', FALSE, TRUE),
('access.roles.assign',           'access',       'roles',         'assign',  'Assign roles',                   'Assign and revoke roles within own scope', FALSE, TRUE),
('access.roles.manage',           'access',       'roles',         'manage',  'Manage roles',                   'Create, edit and retire roles', TRUE, TRUE),
('access.permissions.view',       'access',       'permissions',   'view',    'View permissions',               'View the permission catalogue', FALSE, TRUE),
('access.permissions.manage',     'access',       'permissions',   'manage',  'Manage permissions',             'Change which permissions a role or user has', TRUE, TRUE),
('access.privileged.grant',       'access',       'privileged',    'grant',   'Grant privileged access',        'Grant privileged permissions and roles that contain them', TRUE, TRUE),
('audit.logs.view',               'audit',        'logs',          'view',    'View audit logs',                'View the audit trail', FALSE, TRUE),
('settings.system.view',          'settings',     'system',        'view',    'View settings',                  'View system settings', FALSE, TRUE),
('settings.system.manage',        'settings',     'system',        'manage',  'Manage settings',                'Change system settings', TRUE, TRUE),
('system.database.manage',        'system',       'database',      'manage',  'Database administration',        'Backup, restore, setup and data-clearing operations', TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET
    module = EXCLUDED.module,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    is_privileged = EXCLUDED.is_privileged,
    is_system = TRUE,
    updated_at = NOW();

-- ---------------------------------------------------------------------------
-- role templates (proposed catalogue, to be validated with the business owner)
-- ---------------------------------------------------------------------------
INSERT INTO roles (key, name, description, default_scope, is_system, sod_exempt) VALUES
('super_admin',           'Super Administrator',          'Platform configuration and privileged administration', 'global',     TRUE, TRUE),
('central_access_admin',  'Central Access Administrator', 'User provisioning, role assignments and access reviews', 'global',   TRUE, FALSE),
('central_hr_admin',      'Central HR Administrator',     'Central personnel administration',                     'global',     TRUE, FALSE),
('central_payroll_admin', 'Central Payroll Administrator','Payroll operations and oversight',                     'global',     TRUE, FALSE),
('mda_admin',             'MDA Administrator',            'Local account administration and permitted HR operations', 'mda',    TRUE, FALSE),
('department_head',       'Department Head',              'Team oversight and assigned approvals',                'department', TRUE, FALSE),
('hr_officer',            'HR Officer',                   'Personnel records and HR workflows',                   'mda',        TRUE, FALSE),
('payroll_officer',       'Payroll Officer',              'Payroll preparation and assigned exceptions',          'mda',        TRUE, FALSE),
('finance_officer',       'Finance Officer',              'Approved financial reporting and reconciliation',      'mda',        TRUE, FALSE),
('internal_auditor',      'Internal Auditor',             'Read-only review of authorised records and audit evidence', 'mda',   TRUE, FALSE),
('reporting_officer',     'Reporting Officer',            'Reports and permitted exports',                        'mda',        TRUE, FALSE),
('helpdesk_officer',      'Helpdesk Officer',             'User support and approved account assistance',         'mda',        TRUE, FALSE),
('employee',              'Employee / Self-Service User', 'Personal information and requests',                    'self',       TRUE, FALSE)
ON CONFLICT (key) DO UPDATE SET
    default_scope = EXCLUDED.default_scope,
    is_system = TRUE,
    sod_exempt = EXCLUDED.sod_exempt,
    updated_at = NOW();

-- Template permissions are seeded only while a template has none, so a re-run
-- never undoes changes made through the admin screens.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.is_system AND (
    (r.key = 'super_admin')
 OR (r.key = 'central_access_admin' AND p.key IN (
        'users.accounts.view', 'users.accounts.manage', 'access.roles.view', 'access.roles.assign',
        'access.permissions.view', 'audit.logs.view', 'organization.structure.view'))
 OR (r.key = 'central_hr_admin' AND p.module IN (
        'employees', 'corehr', 'performance', 'organization', 'timesheets', 'calendar',
        'reports', 'recruitment', 'training'))
 OR (r.key = 'central_payroll_admin' AND p.key IN (
        'payroll.cycles.view', 'payroll.cycles.approve', 'payroll.cycles.export',
        'employees.records.view', 'reports.hr.view'))
 OR (r.key = 'mda_admin' AND p.key IN (
        'users.accounts.view', 'users.accounts.manage', 'access.roles.view', 'access.roles.assign',
        'employees.records.view', 'employees.records.create', 'employees.records.update',
        'employees.documents.view', 'employees.documents.verify', 'employees.registrations.view',
        'corehr.records.view', 'corehr.records.manage', 'organization.structure.view',
        'timesheets.attendance.view', 'timesheets.leaves.view', 'reports.hr.view'))
 OR (r.key = 'department_head' AND p.key IN (
        'employees.records.view', 'corehr.records.view', 'corehr.records.approve',
        'timesheets.attendance.view', 'timesheets.leaves.view', 'timesheets.leaves.approve',
        'performance.records.view', 'performance.records.manage',
        'projects.records.view', 'projects.records.approve', 'reports.hr.view'))
 OR (r.key = 'hr_officer' AND p.key IN (
        'employees.records.view', 'employees.records.create', 'employees.records.update',
        'employees.documents.view', 'employees.documents.verify',
        'employees.registrations.view', 'employees.registrations.approve',
        'corehr.records.view', 'corehr.records.manage',
        'timesheets.attendance.view', 'timesheets.attendance.manage',
        'timesheets.leaves.view', 'timesheets.leaves.manage',
        'recruitment.records.view', 'recruitment.records.manage',
        'training.records.view', 'training.records.manage',
        'performance.records.view', 'calendar.events.view', 'calendar.events.manage'))
 OR (r.key = 'payroll_officer' AND p.key IN (
        'payroll.cycles.view', 'payroll.cycles.prepare', 'employees.records.view'))
 OR (r.key = 'finance_officer' AND p.key IN (
        'finance.records.view', 'finance.records.manage', 'finance.records.export',
        'payroll.cycles.view', 'reports.hr.view'))
 OR (r.key = 'internal_auditor' AND (p.action = 'view'))
 OR (r.key = 'reporting_officer' AND p.key IN (
        'reports.hr.view', 'reports.hr.export', 'employees.records.view', 'employees.records.export'))
 OR (r.key = 'helpdesk_officer' AND p.key IN (
        'support.tickets.view', 'support.tickets.manage', 'users.accounts.view'))
 OR (r.key = 'employee' AND p.key IN (
        'employees.records.view', 'employees.documents.view', 'timesheets.attendance.view',
        'timesheets.leaves.view', 'payroll.cycles.view', 'support.tickets.view'))
)
WHERE r.is_system
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- bootstrap: existing active superadmin accounts keep full access, so someone
-- can sign in and assign roles to everyone else. All other accounts start with
-- no access until a role is assigned.
-- Runs only while nobody holds Super Administrator: admin_users.role is an
-- editable legacy field, so a re-run must not turn it into a grant.
-- ---------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id, scope_level, assigned_by, reason)
SELECT u.id::text, r.id, 'global', 'migration', 'Bootstrap: existing superadmin account'
FROM admin_users u
CROSS JOIN roles r
WHERE r.key = 'super_admin'
  AND u.is_active
  AND LOWER(REPLACE(u.role, ' ', '')) = 'superadmin'
  AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.role_id = r.id)
ON CONFLICT DO NOTHING;

COMMIT;
