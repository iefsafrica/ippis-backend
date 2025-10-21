CREATE TABLE IF NOT EXISTS travel_requests (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL,
    employee_name VARCHAR(100) NOT NULL,
    department VARCHAR(50),
    purpose TEXT,
    start_date DATE,
    end_date DATE,
    destination VARCHAR(100),
    travel_mode VARCHAR(50),
    accommodation_type VARCHAR(50),
    estimated_cost NUMERIC(12,2),
    advance_amount NUMERIC(12,2),
    status VARCHAR(30),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);