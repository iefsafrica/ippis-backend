-- Check if created_at column exists, if not add it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'pending_employees' 
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE pending_employees 
        ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Update any existing records that might not have created_at set
UPDATE pending_employees 
SET created_at = NOW() 
WHERE created_at IS NULL;

-- Add an index on created_at for faster sorting
CREATE INDEX IF NOT EXISTS idx_pending_employees_created_at 
ON pending_employees(created_at DESC);

-- Add a unique constraint on email if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'pending_employees_email_unique'
    ) THEN
        ALTER TABLE pending_employees
        ADD CONSTRAINT pending_employees_email_unique UNIQUE (email);
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END $$;
