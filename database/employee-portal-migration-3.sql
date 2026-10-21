-- Employee self-service portal, phases 3 to 7: attendance corrections and
-- timesheets, leave types and entitlements, payroll discrepancy reports,
-- task comments/dependencies/deliverables, employee documents and requests,
-- training enrolments, and employee notifications.
--
-- Additive and safe to re-run. Touches no existing table. Columns that point
-- at existing tables (tasks, training_programs, announcements) carry no
-- foreign key, because those tables were created outside these scripts.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

-- An employee asks HR to fix a day's clock-in or clock-out
CREATE TABLE IF NOT EXISTS attendance_corrections (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    requested_clock_in TIME,
    requested_clock_out TIME,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (requested_clock_in IS NOT NULL OR requested_clock_out IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_corrections_one_pending
    ON attendance_corrections (employee_id, attendance_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS attendance_corrections_status_idx ON attendance_corrections (status, created_at);

-- Weekly timesheets (week_start is a Monday)
CREATE TABLE IF NOT EXISTS employee_timesheets (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    -- [{ "date": "YYYY-MM-DD", "hours": 8, "note": "..." }]
    entries JSONB NOT NULL,
    total_hours NUMERIC(6, 2) NOT NULL,
    employee_note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'approved', 'rejected')),
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, week_start)
);
CREATE INDEX IF NOT EXISTS employee_timesheets_status_idx ON employee_timesheets (status, submitted_at);

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    -- working days allowed per calendar year
    days_per_year INT NOT NULL CHECK (days_per_year >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Starting values for HR to adjust; existing rows are never overwritten
INSERT INTO leave_types (code, name, days_per_year) VALUES
    ('annual', 'Annual leave', 21),
    ('sick', 'Sick leave', 12),
    ('casual', 'Casual leave', 7),
    ('maternity', 'Maternity leave', 112),
    ('paternity', 'Paternity leave', 14),
    ('compassionate', 'Compassionate leave', 5)
ON CONFLICT (code) DO NOTHING;

-- Per-employee override of a leave type's yearly allowance
CREATE TABLE IF NOT EXISTS leave_entitlements (
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id INT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year INT NOT NULL,
    days INT NOT NULL CHECK (days >= 0),
    set_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (employee_id, leave_type_id, year)
);

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_discrepancies (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payment_id VARCHAR(255),
    category VARCHAR(30) NOT NULL
        CHECK (category IN ('missing_payment', 'incorrect_amount', 'incorrect_deduction', 'incorrect_allowance', 'other')),
    description TEXT NOT NULL,
    expected_amount NUMERIC(14, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_review', 'resolved', 'rejected')),
    hr_response TEXT,
    handled_by VARCHAR(255),
    handled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payroll_discrepancies_employee_idx ON payroll_discrepancies (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payroll_discrepancies_status_idx ON payroll_discrepancies (status, created_at);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_comments (
    id SERIAL PRIMARY KEY,
    task_id INT NOT NULL,
    author_type VARCHAR(10) NOT NULL CHECK (author_type IN ('employee', 'admin')),
    author_id VARCHAR(255) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at);

-- task_id cannot be completed before depends_on_task_id
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id INT NOT NULL,
    depends_on_task_id INT NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_deliverables (
    id SERIAL PRIMARY KEY,
    task_id INT NOT NULL,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    size_bytes INT,
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'approved', 'rejected')),
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS task_deliverables_task_idx ON task_deliverables (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_deliverables_status_idx ON task_deliverables (status, created_at);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

-- HR-issued documents (contracts, letters), forms for everyone (employee_id
-- NULL), and documents employees upload for verification
CREATE TABLE IF NOT EXISTS employee_documents (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) REFERENCES employees(id) ON DELETE CASCADE,
    category VARCHAR(30) NOT NULL
        CHECK (category IN ('contract', 'appointment_letter', 'hr_letter', 'form', 'certificate', 'identification', 'other')),
    title VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    size_bytes INT,
    source VARCHAR(10) NOT NULL CHECK (source IN ('hr', 'employee')),
    -- issued: from HR; pending/verified/rejected: employee uploads
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('issued', 'pending', 'verified', 'rejected')),
    request_id INT,
    expires_at DATE,
    uploaded_by VARCHAR(255),
    verified_by VARCHAR(255),
    verified_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (employee_id IS NOT NULL OR category = 'form')
);
CREATE INDEX IF NOT EXISTS employee_documents_employee_idx ON employee_documents (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS employee_documents_status_idx ON employee_documents (status, created_at);

-- HR asks an employee for a document
CREATE TABLE IF NOT EXISTS document_requests (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(30) NOT NULL DEFAULT 'other',
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'submitted', 'fulfilled', 'cancelled')),
    requested_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS document_requests_employee_idx ON document_requests (employee_id, status);

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS training_enrollments (
    training_id INT NOT NULL,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'enrolled'
        CHECK (status IN ('enrolled', 'completed', 'withdrawn')),
    enrolled_by VARCHAR(255),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (training_id, employee_id)
);
CREATE INDEX IF NOT EXISTS training_enrollments_employee_idx ON training_enrollments (employee_id);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_notifications (
    id BIGSERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    -- set for reminders so the same reminder is never created twice
    dedupe_key VARCHAR(150),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS employee_notifications_inbox_idx
    ON employee_notifications (employee_id, is_read, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS employee_notifications_dedupe_key
    ON employee_notifications (employee_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_notification_preferences (
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category VARCHAR(20) NOT NULL,
    in_app BOOLEAN NOT NULL DEFAULT TRUE,
    email BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (employee_id, category)
);

CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id INT NOT NULL,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (announcement_id, employee_id)
);

COMMIT;
