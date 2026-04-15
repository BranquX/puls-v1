-- Add meta_token_expires_at column to track when the long-lived Meta token expires
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_token_expires_at timestamp;
