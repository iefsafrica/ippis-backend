-- Create pending_employees table
CREATE TABLE IF NOT EXISTS pending_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  department VARCHAR(100),
  position VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
  source VARCHAR(50) NOT NULL DEFAULT 'form',
  submission_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  missing_fields JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pending_employees_email ON pending_employees(email);
CREATE INDEX IF NOT EXISTS idx_pending_employees_status ON pending_employees(status);
CREATE INDEX IF NOT EXISTS idx_pending_employees_department ON pending_employees(department);
CREATE INDEX IF NOT EXISTS idx_pending_employees_source ON pending_employees(source);
CREATE INDEX IF NOT EXISTS idx_pending_employees_submission_date ON pending_employees(submission_date);
