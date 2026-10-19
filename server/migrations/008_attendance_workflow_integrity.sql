-- Allow a new WFH request after a previous request is rejected or cancelled,
-- while still enforcing one pending/approved request per employee and date.
ALTER TABLE wfh_requests DROP INDEX uq_wfh_employee_day;
ALTER TABLE wfh_requests
  ADD COLUMN active_request_date DATE GENERATED ALWAYS AS (
    CASE WHEN status IN ('PENDING','APPROVED') THEN request_date ELSE NULL END
  ) STORED;
ALTER TABLE wfh_requests ADD UNIQUE KEY uq_wfh_active_employee_day (employee_id, active_request_date);

-- A missed punch-out may be recorded away from the office without weakening
-- the location verification required for check-in.
ALTER TABLE attendance_records
  MODIFY COLUMN check_in_method ENUM('GPS','WIFI','QR','WFH','ADMIN','OFF_PREMISES') NULL,
  MODIFY COLUMN check_out_method ENUM('GPS','WIFI','QR','WFH','ADMIN','OFF_PREMISES') NULL;
