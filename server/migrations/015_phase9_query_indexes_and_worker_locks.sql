-- Migration 015: Phase 9 Performance Optimization, Query Indexing & Worker Lock Recovery
-- Defect References: HRMS-DEF-036 (Unindexed Queries), HRMS-DEF-027 (Worker Lock Starvation)

-- 1. attendance_records: Composite index for monthly payroll and history queries (HRMS-DEF-036)
SET @idx_att_emp_date = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'attendance_records' AND index_name = 'idx_attendance_emp_date'
);
SET @sql_att_emp_date = IF(@idx_att_emp_date = 0,
  'ALTER TABLE attendance_records ADD INDEX idx_attendance_emp_date (employee_id, attendance_date)',
  'SELECT 1'
);
PREPARE stmt_att_emp_date FROM @sql_att_emp_date;
EXECUTE stmt_att_emp_date;
DEALLOCATE PREPARE stmt_att_emp_date;

-- 2. attendance_records: Composite index for employee date range status lookups
SET @idx_att_emp_date_status = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'attendance_records' AND index_name = 'idx_attendance_emp_date_status'
);
SET @sql_att_emp_date_status = IF(@idx_att_emp_date_status = 0,
  'ALTER TABLE attendance_records ADD INDEX idx_attendance_emp_date_status (employee_id, attendance_date, status)',
  'SELECT 1'
);
PREPARE stmt_att_emp_date_status FROM @sql_att_emp_date_status;
EXECUTE stmt_att_emp_date_status;
DEALLOCATE PREPARE stmt_att_emp_date_status;

-- 3. leave_requests: Index for employee balance calculation and status filtering (HRMS-DEF-036)
SET @idx_leave_emp_status = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'leave_requests' AND index_name = 'idx_leave_emp_status'
);
SET @sql_leave_emp_status = IF(@idx_leave_emp_status = 0,
  'ALTER TABLE leave_requests ADD INDEX idx_leave_emp_status (employee_id, status)',
  'SELECT 1'
);
PREPARE stmt_leave_emp_status FROM @sql_leave_emp_status;
EXECUTE stmt_leave_emp_status;
DEALLOCATE PREPARE stmt_leave_emp_status;

-- 4. leave_requests: Chronological request index per employee
SET @idx_leave_emp_created = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'leave_requests' AND index_name = 'idx_leave_emp_created'
);
SET @sql_leave_emp_created = IF(@idx_leave_emp_created = 0,
  'ALTER TABLE leave_requests ADD INDEX idx_leave_emp_created (employee_id, created_at)',
  'SELECT 1'
);
PREPARE stmt_leave_emp_created FROM @sql_leave_emp_created;
EXECUTE stmt_leave_emp_created;
DEALLOCATE PREPARE stmt_leave_emp_created;

-- 5. email_outbox: Status and availability index for fast batch polling (HRMS-DEF-036 / HRMS-DEF-027)
SET @idx_outbox_status_avail = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'email_outbox' AND index_name = 'idx_outbox_status_available'
);
SET @sql_outbox_status_avail = IF(@idx_outbox_status_avail = 0,
  'ALTER TABLE email_outbox ADD INDEX idx_outbox_status_available (status, available_at)',
  'SELECT 1'
);
PREPARE stmt_outbox_status_avail FROM @sql_outbox_status_avail;
EXECUTE stmt_outbox_status_avail;
DEALLOCATE PREPARE stmt_outbox_status_avail;

-- 6. email_outbox: Worker lease recovery index for orphaned lock detection (HRMS-DEF-027)
SET @idx_outbox_status_lease = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'email_outbox' AND index_name = 'idx_outbox_status_lease'
);
SET @sql_outbox_status_lease = IF(@idx_outbox_status_lease = 0,
  'ALTER TABLE email_outbox ADD INDEX idx_outbox_status_lease (status, lease_until, locked_at)',
  'SELECT 1'
);
PREPARE stmt_outbox_status_lease FROM @sql_outbox_status_lease;
EXECUTE stmt_outbox_status_lease;
DEALLOCATE PREPARE stmt_outbox_status_lease;

-- 7. wfh_requests: Employee active WFH date search index
SET @idx_wfh_emp_status_date = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'wfh_requests' AND index_name = 'idx_wfh_emp_status_date'
);
SET @sql_wfh_emp_status_date = IF(@idx_wfh_emp_status_date = 0,
  'ALTER TABLE wfh_requests ADD INDEX idx_wfh_emp_status_date (employee_id, status, request_date)',
  'SELECT 1'
);
PREPARE stmt_wfh_emp_status_date FROM @sql_wfh_emp_status_date;
EXECUTE stmt_wfh_emp_status_date;
DEALLOCATE PREPARE stmt_wfh_emp_status_date;

-- 8. attendance_correction_requests: Employee active correction lookup index
SET @idx_corr_emp_status = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'attendance_correction_requests' AND index_name = 'idx_correction_emp_status'
);
SET @sql_corr_emp_status = IF(@idx_corr_emp_status = 0,
  'ALTER TABLE attendance_correction_requests ADD INDEX idx_correction_emp_status (employee_id, status, attendance_date)',
  'SELECT 1'
);
PREPARE stmt_corr_emp_status FROM @sql_corr_emp_status;
EXECUTE stmt_corr_emp_status;
DEALLOCATE PREPARE stmt_corr_emp_status;

-- 9. flex_start_requests: Employee active flex-start lookup index
SET @idx_flex_emp_status = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'flex_start_requests' AND index_name = 'idx_flex_emp_status'
);
SET @sql_flex_emp_status = IF(@idx_flex_emp_status = 0,
  'ALTER TABLE flex_start_requests ADD INDEX idx_flex_emp_status (employee_id, status, request_date)',
  'SELECT 1'
);
PREPARE stmt_flex_emp_status FROM @sql_flex_emp_status;
EXECUTE stmt_flex_emp_status;
DEALLOCATE PREPARE stmt_flex_emp_status;

-- 10. notifications: Employee chronological notification feed index
SET @idx_notif_emp_created = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'notifications' AND index_name = 'idx_notifications_emp_created'
);
SET @sql_notif_emp_created = IF(@idx_notif_emp_created = 0,
  'ALTER TABLE notifications ADD INDEX idx_notifications_emp_created (employee_id, created_at)',
  'SELECT 1'
);
PREPARE stmt_notif_emp_created FROM @sql_notif_emp_created;
EXECUTE stmt_notif_emp_created;
DEALLOCATE PREPARE stmt_notif_emp_created;

-- 11. learning_allowances: Employee fiscal year claim lookup index
SET @idx_learn_emp_fiscal = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'learning_allowances' AND index_name = 'idx_learning_emp_fiscal_status'
);
SET @sql_learn_emp_fiscal = IF(@idx_learn_emp_fiscal = 0,
  'ALTER TABLE learning_allowances ADD INDEX idx_learning_emp_fiscal_status (employee_id, fiscal_year, status)',
  'SELECT 1'
);
PREPARE stmt_learn_emp_fiscal FROM @sql_learn_emp_fiscal;
EXECUTE stmt_learn_emp_fiscal;
DEALLOCATE PREPARE stmt_learn_emp_fiscal;
