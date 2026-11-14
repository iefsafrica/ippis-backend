-- Table for individual and bulk uploaded payroll deductions
CREATE TABLE IF NOT EXISTS payroll_deductions (
  id SERIAL PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  period VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
  deduction_type VARCHAR(50) NOT NULL DEFAULT 'loan_deduction',
  description VARCHAR(255),
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  effective_date DATE,
  uploaded_by VARCHAR(255),
  batch_id VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payroll_deductions_emp ON payroll_deductions(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_per ON payroll_deductions(period);

