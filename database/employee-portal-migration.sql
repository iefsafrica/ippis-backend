-- Employee self-service portal, phase 1: employee sign-in accounts.
-- Additive and safe to re-run. Touches no existing table.
--
-- An employee gets an account when HR sends them an invite. The invite link
-- lets them choose a password; until then the account cannot sign in.
-- Tokens are stored only as SHA-256 hashes.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee_accounts (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(255) NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
    password_hash TEXT,
    -- invited: link sent, no password yet; active: can sign in;
    -- suspended / deactivated: cannot sign in, existing sessions revoked
    status VARCHAR(20) NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
    invite_token_hash VARCHAR(64),
    invite_expires_at TIMESTAMPTZ,
    reset_token_hash VARCHAR(64),
    reset_expires_at TIMESTAMPTZ,
    -- tokens carry this number; raising it ends every existing session
    token_version INT NOT NULL DEFAULT 0,
    password_changed_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    invited_by VARCHAR(255),
    invited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_accounts_invite_token_key
    ON employee_accounts (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_accounts_reset_token_key
    ON employee_accounts (reset_token_hash) WHERE reset_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_accounts_status_idx ON employee_accounts (status);

COMMIT;
