-- Replace the all-status WFH unique key with a generated active-date key.
-- The employee foreign key needs its own leading employee_id index before the
-- old unique key can be removed. Run the DDL as one atomic ALTER statement.
SET @hrms_wfh_old_unique = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=DATABASE() AND table_name='wfh_requests' AND index_name='uq_wfh_employee_day'
);
SET @hrms_wfh_alter = IF(
  @hrms_wfh_old_unique > 0,
  'ALTER TABLE wfh_requests DROP FOREIGN KEY fk_wfh_employee, DROP INDEX uq_wfh_employee_day, ADD COLUMN active_request_date DATE GENERATED ALWAYS AS (CASE WHEN status IN (''PENDING'',''APPROVED'') THEN request_date ELSE NULL END) STORED, ADD INDEX idx_wfh_employee_request_date (employee_id, request_date), ADD UNIQUE KEY uq_wfh_active_employee_day (employee_id, active_request_date), ADD CONSTRAINT fk_wfh_employee FOREIGN KEY (employee_id) REFERENCES employees(id)',
  'SELECT 1'
);
PREPARE hrms_wfh_stmt FROM @hrms_wfh_alter;
EXECUTE hrms_wfh_stmt;
DEALLOCATE PREPARE hrms_wfh_stmt;

-- A missed punch-out may be recorded away from the office without weakening
-- the location verification required for check-in.
ALTER TABLE attendance_records
  MODIFY COLUMN check_in_method ENUM('GPS','WIFI','QR','WFH','ADMIN','OFF_PREMISES') NULL,
  MODIFY COLUMN check_out_method ENUM('GPS','WIFI','QR','WFH','ADMIN','OFF_PREMISES') NULL;
