-- SQL Schema for File Manager Module
-- Run this in your database console to initialize Folder and File tables.

-- 1. Folders Table (supports nested structure)
CREATE TABLE IF NOT EXISTS file_manager_folders (
    id SERIAL PRIMARY KEY,
    folder_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id VARCHAR(50), -- Null represents Root Directory
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (parent_id) REFERENCES file_manager_folders(folder_id) ON DELETE CASCADE
);

-- 2. Files Table
CREATE TABLE IF NOT EXISTS file_manager_files (
    id SERIAL PRIMARY KEY,
    file_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    folder_id VARCHAR(50), -- Null means Root Directory
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size BIGINT, -- size in bytes
    uploaded_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (folder_id) REFERENCES file_manager_folders(folder_id) ON DELETE CASCADE
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_file_folders_parent ON file_manager_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_file_files_folder ON file_manager_files(folder_id);

-- Trigger to update updated_at timestamp
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_file_folders_updated_at') THEN
        CREATE TRIGGER trg_update_file_folders_updated_at 
        BEFORE UPDATE ON file_manager_folders 
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_file_files_updated_at') THEN
        CREATE TRIGGER trg_update_file_files_updated_at 
        BEFORE UPDATE ON file_manager_files 
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    END IF;
END $$;
