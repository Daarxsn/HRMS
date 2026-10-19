-- Add office-network verification as a recorded attendance method.
-- Keep QR in the enum to preserve compatibility with any historical records;
-- QR check-in is not enabled by the current API.
ALTER TABLE attendance_records
  MODIFY COLUMN check_in_method ENUM('GPS','WIFI','QR','WFH','ADMIN') NULL,
  MODIFY COLUMN check_out_method ENUM('GPS','WIFI','QR','WFH','ADMIN') NULL;
