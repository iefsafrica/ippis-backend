-- Run this SQL command in your database console if you still get 'column payee_id does not exist'
-- This script ensures the finance_expenses table has the correct column name.

DO $$ 
BEGIN
    -- Check if payer_id exists and needs to be renamed to payee_id
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'finance_expenses' AND column_name = 'payer_id'
    ) THEN
        ALTER TABLE finance_expenses RENAME COLUMN payer_id TO payee_id;
    END IF;

    -- Alternatively, if no column exists, add it
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'finance_expenses' AND column_name = 'payee_id'
    ) THEN
        ALTER TABLE finance_expenses ADD COLUMN payee_id VARCHAR(255);
    END IF;
END $$;
