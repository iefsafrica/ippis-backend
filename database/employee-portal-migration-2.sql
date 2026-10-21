-- Employee self-service portal, phase 2: profile change requests and emergency contacts.
-- Additive and safe to re-run. Touches no existing table.
--
-- Employees cannot edit their HR record directly. They submit a change request;
-- an HR officer with employees.records.approve approves or rejects it, and only
-- an approved request changes the record.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee_profile_change_requests (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    -- { "field": { "from": old value, "to": new value }, ... }
    changes JSONB NOT NULL,
    employee_note TEXT,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open request per employee at a time
CREATE UNIQUE INDEX IF NOT EXISTS employee_profile_change_requests_one_pending
    ON employee_profile_change_requests (employee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS employee_profile_change_requests_status_idx
    ON employee_profile_change_requests (status, created_at);

-- Contact details as approved through the portal. Not every employee has an
-- onboarding personal_info row, so approved values are always kept here and
-- also copied into personal_info when that row exists.
CREATE TABLE IF NOT EXISTS employee_contact_info (
    employee_id VARCHAR(255) PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    phone VARCHAR(30),
    address TEXT,
    state_of_residence VARCHAR(100),
    marital_status VARCHAR(30),
    next_of_kin_name VARCHAR(255),
    next_of_kin_relationship VARCHAR(50),
    next_of_kin_phone VARCHAR(30),
    next_of_kin_address TEXT,
    last_request_id INT REFERENCES employee_profile_change_requests(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Emergency contacts are the employee's own list and need no approval
CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    alternate_phone VARCHAR(30),
    email VARCHAR(255),
    address TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_emergency_contacts_employee_idx
    ON employee_emergency_contacts (employee_id);
-- At most one primary contact per employee
CREATE UNIQUE INDEX IF NOT EXISTS employee_emergency_contacts_one_primary
    ON employee_emergency_contacts (employee_id) WHERE is_primary;

COMMIT;
