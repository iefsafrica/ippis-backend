-- SQL to create the finance_transactions table
-- This table tracks all financial movements (Incomes, Expenses, and Transfers)

CREATE TABLE IF NOT EXISTS finance_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) UNIQUE NOT NULL,
    account_id VARCHAR(50) NOT NULL REFERENCES finance_accounts(account_id),
    transaction_type VARCHAR(20) NOT NULL, -- 'Income', 'Expense', 'Transfer'
    amount DECIMAL(15, 2) NOT NULL,
    payment_method VARCHAR(50),
    category VARCHAR(100),
    reference_id VARCHAR(100), -- Optional link to other entities
    description TEXT,
    status VARCHAR(20) DEFAULT 'Completed', -- 'Completed', 'Pending', 'Failed'
    transaction_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_finance_transactions_account_id ON finance_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions(transaction_date);

-- Trigger to update updated_at timestamp
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_finance_transactions_updated_at') THEN
        CREATE TRIGGER trg_update_finance_transactions_updated_at 
        BEFORE UPDATE ON finance_transactions 
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;
