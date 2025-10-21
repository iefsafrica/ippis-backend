CREATE TABLE employee_transfers (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    from_department VARCHAR(100),
    to_department VARCHAR(100) NOT NULL,
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    transfer_reason TEXT,
    transfer_type VARCHAR(50) NOT NULL DEFAULT 'internal', -- internal, promotion, disciplinary, etc.
    requested_by INTEGER, -- admin who initiated it
    approved_by INTEGER, -- admin who approved it
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, completed
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP,
    effective_date DATE NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES admin_users(id) ON DELETE SET NULL
);
