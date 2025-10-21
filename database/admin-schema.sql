
-- Admin users table
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'admin', -- superadmin, admin, viewer
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Admin sessions table
CREATE TABLE admin_sessions (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(50),
    user_agent TEXT,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Dashboard notifications table
CREATE TABLE dashboard_notifications (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) NOT NULL, -- info, warning, error, success
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    recipient_id INTEGER, -- NULL for broadcast notifications
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    action_url TEXT,
    FOREIGN KEY (recipient_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Dashboard widgets configuration
CREATE TABLE dashboard_widgets (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    widget_type VARCHAR(50) NOT NULL, -- stats, chart, activity, etc.
    widget_position INTEGER NOT NULL,
    widget_size VARCHAR(20) NOT NULL DEFAULT 'medium', -- small, medium, large
    widget_config JSONB NOT NULL DEFAULT '{}',
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Admin action permissions
CREATE TABLE admin_permissions (
    id SERIAL PRIMARY KEY,
    role VARCHAR(20) NOT NULL,
    resource VARCHAR(50) NOT NULL, -- employees, documents, settings, etc.
    action VARCHAR(20) NOT NULL, -- create, read, update, delete, approve, reject
    is_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role, resource, action)
);

-- Default superadmin user (bcrypt hash of 'admin123')
INSERT INTO admin_users (username, email, password_hash, full_name, role)
VALUES ('admin', 'admin@ippis.gov.ng', '$2a$10$rM7xU0XJsZLD.KlUfVGYp.k.6.HUQQYyRcmxg1Tn9xO.PKnL/Qnw2', 'System Administrator', 'superadmin');

-- Default permissions for superadmin
INSERT INTO admin_permissions (role, resource, action, is_allowed) VALUES
('superadmin', 'employees', 'create', TRUE),
('superadmin', 'employees', 'read', TRUE),
('superadmin', 'employees', 'update', TRUE),
('superadmin', 'employees', 'delete', TRUE),
('superadmin', 'documents', 'read', TRUE),
('superadmin', 'documents', 'verify', TRUE),
('superadmin', 'documents', 'reject', TRUE),
('superadmin', 'settings', 'read', TRUE),
('superadmin', 'settings', 'update', TRUE),
('superadmin', 'admin_users', 'create', TRUE),
('superadmin', 'admin_users', 'read', TRUE),
('superadmin', 'admin_users', 'update', TRUE),
('superadmin', 'admin_users', 'delete', TRUE);

-- Default permissions for admin
INSERT INTO admin_permissions (role, resource, action, is_allowed) VALUES
('admin', 'employees', 'read', TRUE),
('admin', 'employees', 'update', TRUE),
('admin', 'documents', 'read', TRUE),
('admin', 'documents', 'verify', TRUE),
('admin', 'documents', 'reject', TRUE),
('admin', 'settings', 'read', TRUE);

-- Default permissions for viewer
INSERT INTO admin_permissions (role, resource, action, is_allowed) VALUES
('viewer', 'employees', 'read', TRUE),
('viewer', 'documents', 'read', TRUE);
