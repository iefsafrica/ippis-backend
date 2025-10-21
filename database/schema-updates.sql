-- Add missing_fields column to pending_employees table
ALTER TABLE pending_employees ADD COLUMN IF NOT EXISTS missing_fields JSONB DEFAULT '[]'::jsonb;

-- Add relationship columns
ALTER TABLE pending_employees ADD COLUMN IF NOT EXISTS employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL;

-- Add status tracking columns
ALTER TABLE pending_employees ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE pending_employees ADD COLUMN IF NOT EXISTS status_updated_by TEXT;

-- Create a view that combines employees and pending employees for dashboard stats
CREATE OR REPLACE VIEW employee_statistics AS
SELECT
  (SELECT COUNT(*) FROM employees WHERE status = 'active') as active_employees,
  (SELECT COUNT(*) FROM employees WHERE status = 'inactive') as inactive_employees,
  (SELECT COUNT(*) FROM pending_employees WHERE status = 'pending_approval') as pending_approval,
  (SELECT COUNT(*) FROM pending_employees WHERE status = 'document_verification') as pending_documents,
  (SELECT COUNT(*) FROM pending_employees WHERE status = 'data_incomplete') as incomplete_data;

-- Create a function to identify missing fields in employee data
CREATE OR REPLACE FUNCTION check_missing_fields(data JSONB) 
RETURNS JSONB AS $$
DECLARE
  missing_fields JSONB := '[]'::jsonb;
BEGIN
  -- Check required fields
  IF NOT (data ? 'surname' AND data->>'surname' <> '') THEN
    missing_fields = missing_fields || '"Surname"';
  END IF;
  
  IF NOT (data ? 'firstname' AND data->>'firstname' <> '') THEN
    missing_fields = missing_fields || '"First Name"';
  END IF;
  
  IF NOT (data ? 'email' AND data->>'email' <> '') THEN
    missing_fields = missing_fields || '"Email"';
  END IF;
  
  -- Check recommended fields
  IF NOT (data ? 'department' AND data->>'department' <> '') THEN
    missing_fields = missing_fields || '"Department"';
  END IF;
  
  IF NOT (data ? 'position' AND data->>'position' <> '') THEN
    missing_fields = missing_fields || '"Position"';
  END IF;
  
  RETURN missing_fields;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically update missing_fields
CREATE OR REPLACE FUNCTION update_missing_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.missing_fields = check_missing_fields(
    jsonb_build_object(
      'surname', NEW.surname,
      'firstname', NEW.firstname,
      'email', NEW.email,
      'department', NEW.department,
      'position', NEW.position
    ) || COALESCE(NEW.metadata, '{}'::jsonb)
  );
  
  -- Update status if there are missing fields
  IF jsonb_array_length(NEW.missing_fields) > 0 THEN
    NEW.status = 'data_incomplete';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on pending_employees
DROP TRIGGER IF EXISTS update_missing_fields_trigger ON pending_employees;
CREATE TRIGGER update_missing_fields_trigger
BEFORE INSERT OR UPDATE ON pending_employees
FOR EACH ROW
EXECUTE FUNCTION update_missing_fields();
