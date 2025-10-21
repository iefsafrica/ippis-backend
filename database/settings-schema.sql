-- Create settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS admin_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT,
  category VARCHAR(100) NOT NULL,
  data_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255)
);

-- Insert default settings if they don't exist
INSERT INTO admin_settings (key, value, category, data_type)
VALUES
  -- General Settings
  ('systemName', 'IPPIS Admin Portal', 'general', 'string'),
  ('systemLogo', '', 'general', 'string'),
  ('systemLanguage', 'en', 'general', 'string'),
  ('systemTimezone', 'Africa/Lagos', 'general', 'string'),
  
  -- Notification Settings
  ('emailNotifications', 'true', 'notifications', 'boolean'),
  ('systemNotifications', 'true', 'notifications', 'boolean'),
  ('notificationFrequency', 'immediate', 'notifications', 'string'),
  
  -- Email Settings
  ('emailServer', '', 'email', 'string'),
  ('emailPort', '', 'email', 'string'),
  ('emailUsername', '', 'email', 'string'),
  ('emailPassword', '', 'email', 'string'),
  ('emailFrom', '', 'email', 'string'),
  ('emailReplyTo', '', 'email', 'string'),
  ('emailTemplate', '', 'email', 'string'),
  
  -- Appearance Settings
  ('systemTheme', 'light', 'appearance', 'string'),
  ('primaryColor', '#22c55e', 'appearance', 'string'),
  ('secondaryColor', '#f97316', 'appearance', 'string'),
  ('fontFamily', 'Inter', 'appearance', 'string'),
  
  -- Advanced Settings
  ('documentVerificationMode', 'manual', 'advanced', 'string'),
  ('systemDateFormat', 'DD/MM/YYYY', 'advanced', 'string'),
  ('systemTimeFormat', 'HH:mm', 'advanced', 'string'),
  ('systemCurrency', 'NGN', 'advanced', 'string'),
  ('systemDecimalSeparator', '.', 'advanced', 'string'),
  ('systemThousandSeparator', ',', 'advanced', 'string'),
  ('debugMode', 'false', 'advanced', 'boolean'),
  ('maintenanceMode', 'false', 'advanced', 'boolean')
ON CONFLICT (key) DO NOTHING;
