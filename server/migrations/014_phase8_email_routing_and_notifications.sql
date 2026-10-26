-- Migration 014: Phase 8 Email Notification Engine & Recipient Routing
-- Adds cc_json column to email_outbox for dynamic manager CC and dual dispatch

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'email_outbox'
    AND column_name = 'cc_json'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE email_outbox ADD COLUMN cc_json JSON NULL AFTER recipients_json',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
