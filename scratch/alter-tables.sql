ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_user_id_fkey;

ALTER TABLE user_roles ALTER COLUMN user_id TYPE VARCHAR(50);
ALTER TABLE user_permissions ALTER COLUMN user_id TYPE VARCHAR(50);
