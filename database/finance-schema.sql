-- IPPIS HR Finance Module Schema
-- Run this script in your Neon SQL console to initialize the finance tables.

-- 1. Finance Accounts
CREATE TABLE IF NOT EXISTS finance_accounts (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(50) UNIQUE NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    currency VARCHAR(10) DEFAULT 'NGN',
    balance DECIMAL(15, 2) DEFAULT 0.00,
    opening_date DATE,
    status VARCHAR(20) DEFAULT 'Active',
    branch_code VARCHAR(50),
    swift_code VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Finance Payers (Entities providing income/deposits)
CREATE TABLE IF NOT EXISTS finance_payers (
    id SERIAL PRIMARY KEY,
    payer_id VARCHAR(50) UNIQUE NOT NULL,
    payer_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    account_number VARCHAR(50),
    bank_name VARCHAR(255),
    tax_id VARCHAR(100),
    category VARCHAR(100),
    status VARCHAR(20) DEFAULT 'Active',
    notes TEXT,
    last_payment DECIMAL(15, 2) DEFAULT 0.00,
    last_payment_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Finance Payees (Entities receiving payments/expenses)
CREATE TABLE IF NOT EXISTS finance_payees (
    id SERIAL PRIMARY KEY,
    payee_id VARCHAR(50) UNIQUE NOT NULL,
    payee_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    account_number VARCHAR(50),
    bank_name VARCHAR(255),
    tax_id VARCHAR(100),
    category VARCHAR(100),
    status VARCHAR(20) DEFAULT 'Active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Finance Deposits (Incoming Transactions)
CREATE TABLE IF NOT EXISTS finance_deposits (
    id SERIAL PRIMARY KEY,
    deposit_id VARCHAR(50) UNIQUE NOT NULL,
    account_id VARCHAR(50) REFERENCES finance_accounts(account_id),
    payer_id VARCHAR(50) REFERENCES finance_payers(payer_id),
    amount DECIMAL(15, 2) NOT NULL,
    payment_method VARCHAR(50),
    category VARCHAR(100),
    reference VARCHAR(255),
    description TEXT,
    status VARCHAR(20) DEFAULT 'Completed',
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Finance Expenses (Outgoing Transactions)
CREATE TABLE IF NOT EXISTS finance_expenses (
    id SERIAL PRIMARY KEY,
    expense_id VARCHAR(50) UNIQUE NOT NULL,
    account_id VARCHAR(50) REFERENCES finance_accounts(account_id),
    payee_id VARCHAR(50) REFERENCES finance_payees(payee_id),
    amount DECIMAL(15, 2) NOT NULL,
    payment_method VARCHAR(50),
    category VARCHAR(100),
    reference VARCHAR(255),
    description TEXT,
    status VARCHAR(20) DEFAULT 'Pending',
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_finance_accounts_updated_at BEFORE UPDATE ON finance_accounts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_finance_payers_updated_at BEFORE UPDATE ON finance_payers FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_finance_payees_updated_at BEFORE UPDATE ON finance_payees FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_finance_deposits_updated_at BEFORE UPDATE ON finance_deposits FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_finance_expenses_updated_at BEFORE UPDATE ON finance_expenses FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
