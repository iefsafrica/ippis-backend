-- SQL to create the finance_transfers table
-- This table tracks movement of funds between bank accounts

CREATE TABLE IF NOT EXISTS finance_transfers (
    id SERIAL PRIMARY KEY,
    transfer_id VARCHAR(50) UNIQUE NOT NULL,
    from_account_id VARCHAR(50) NOT NULL REFERENCES finance_accounts(account_id),
    to_account_id VARCHAR(50) NOT NULL REFERENCES finance_accounts(account_id),
    amount DECIMAL(15, 2) NOT NULL,
    fees DECIMAL(15, 2) DEFAULT 0.00,
    payment_mode VARCHAR(50), -- e.g., Wallet, Bank Transfer, Card
    reference_no VARCHAR(100),
    description TEXT,
    status VARCHAR(20) DEFAULT 'Completed',
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_finance_transfers_from ON finance_transfers(from_account_id);
CREATE INDEX IF NOT EXISTS idx_finance_transfers_to ON finance_transfers(to_account_id);
CREATE INDEX IF NOT EXISTS idx_finance_transfers_date ON finance_transfers(date);

-- Trigger for updated_at
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_finance_transfers_updated_at') THEN
        CREATE TRIGGER trg_update_finance_transfers_updated_at 
        BEFORE UPDATE ON finance_transfers 
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;
