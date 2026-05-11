-- database/backup-schema.sql
-- Run this in Neon SQL editor to create the backup tracking table

CREATE TABLE IF NOT EXISTS database_backups (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_name   VARCHAR(255),
  backup_type   VARCHAR(50)   NOT NULL DEFAULT 'full',      -- full | partial
  location      VARCHAR(50)   NOT NULL DEFAULT 'local',     -- local | cloud
  compression   VARCHAR(20)   NOT NULL DEFAULT 'medium',    -- none | low | medium | high
  encryption    VARCHAR(20)   NOT NULL DEFAULT 'AES-256',   -- none | AES-128 | AES-256
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending',   -- pending | in_progress | completed | failed
  size_bytes    BIGINT,
  tables_included TEXT[]      DEFAULT '{}',
  row_counts    JSONB         DEFAULT '{}',
  backup_data   JSONB         DEFAULT '{}',
  error_message TEXT,
  created_by    VARCHAR(255)  DEFAULT 'system',
  created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMPTZ,
  restored_at   TIMESTAMPTZ,
  restored_by   VARCHAR(255)
);

-- Index for faster history queries
CREATE INDEX IF NOT EXISTS idx_database_backups_created_at ON database_backups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_database_backups_status     ON database_backups (status);
