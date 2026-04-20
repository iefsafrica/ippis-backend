-- SQL Schema for Asset Management Module
-- Run this in your database console to initialize Asset and Category tables.

-- 1. Asset Categories Table
CREATE TABLE IF NOT EXISTS asset_categories (
    id SERIAL PRIMARY KEY,
    category_id VARCHAR(50) UNIQUE NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Assets Table
CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(50) UNIQUE NOT NULL,
    asset_name VARCHAR(255) NOT NULL,
    category_id VARCHAR(50) REFERENCES asset_categories(category_id),
    serial_number VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Available',
    
    -- Additional Info
    location VARCHAR(255),
    assigned_to VARCHAR(255),
    notes TEXT,

    -- Financial Info
    purchase_date DATE,
    purchase_cost DECIMAL(15, 2),
    vendor_name VARCHAR(255),
    warranty_expiry DATE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assets_category_id ON assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_asset_categories_status ON asset_categories(status);

-- Trigger to update updated_at timestamp
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_asset_categories_updated_at') THEN
        CREATE TRIGGER trg_update_asset_categories_updated_at 
        BEFORE UPDATE ON asset_categories 
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_assets_updated_at') THEN
        CREATE TRIGGER trg_update_assets_updated_at 
        BEFORE UPDATE ON assets 
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;
