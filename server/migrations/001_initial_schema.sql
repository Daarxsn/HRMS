CREATE TABLE IF NOT EXISTS employees (
  id CHAR(36) PRIMARY KEY,
  employee_code VARCHAR(24) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  google_subject VARCHAR(255) NULL UNIQUE,
  role ENUM('ADMIN','EMPLOYEE') NOT NULL DEFAULT 'EMPLOYEE',
  user_type ENUM('EMPLOYEE','INTERN','ADMIN') NOT NULL DEFAULT 'EMPLOYEE',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  title VARCHAR(120) NOT NULL DEFAULT 'Employee',
  phone VARCHAR(32) NULL,
  reporting_manager_id CHAR(36) NULL,
  joined_on DATE NOT NULL,
  probation_end_date DATE NULL,
  wfh_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employees_status_role (status, role),
  INDEX idx_employees_name (full_name),
  CONSTRAINT fk_employee_manager FOREIGN KEY (reporting_manager_id) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(500) NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_setting_actor FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS attendance_records (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  attendance_date DATE NOT NULL,
  check_in_at DATETIME NULL,
  check_out_at DATETIME NULL,
  check_in_method ENUM('GPS','QR','WFH','ADMIN') NULL,
  check_out_method ENUM('GPS','QR','WFH','ADMIN') NULL,
  check_in_latitude DECIMAL(10,7) NULL,
  check_in_longitude DECIMAL(10,7) NULL,
  check_in_accuracy_m DECIMAL(8,2) NULL,
  check_in_distance_m DECIMAL(9,2) NULL,
  check_out_latitude DECIMAL(10,7) NULL,
  check_out_longitude DECIMAL(10,7) NULL,
  check_out_accuracy_m DECIMAL(8,2) NULL,
  status ENUM('ON_TIME','LATE_ENTRY','ON_LEAVE','WFH','ABSENT') NOT NULL DEFAULT 'ON_TIME',
  approved_start_time TIME NULL,
  correction_pending BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uq_attendance_employee_date (employee_id, attendance_date),
  INDEX idx_attendance_date_status (attendance_date, status),
  INDEX idx_attendance_open (check_out_at, attendance_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS qr_challenges (
  id CHAR(36) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_by CHAR(36) NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_created_by FOREIGN KEY (created_by) REFERENCES employees(id),
  INDEX idx_qr_expiry (expires_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS qr_challenge_uses (
  id CHAR(36) PRIMARY KEY,
  challenge_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  event_type ENUM('CHECK_IN','CHECK_OUT') NOT NULL,
  used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_use_challenge FOREIGN KEY (challenge_id) REFERENCES qr_challenges(id),
  CONSTRAINT fk_qr_use_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uq_qr_employee_event (challenge_id, employee_id, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS attendance_correction_requests (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  attendance_id CHAR(36) NULL,
  attendance_date DATE NOT NULL,
  requested_check_in_at DATETIME NULL,
  requested_check_out_at DATETIME NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewer_note VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_correction_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_correction_attendance FOREIGN KEY (attendance_id) REFERENCES attendance_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_correction_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_correction_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS employee_schedule_exceptions (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  exception_date DATE NOT NULL,
  approved_start_time TIME NOT NULL,
  approved_by CHAR(36) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_schedule_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_schedule_approver FOREIGN KEY (approved_by) REFERENCES employees(id),
  UNIQUE KEY uq_schedule_exception (employee_id, exception_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS flex_start_requests (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  request_date DATE NOT NULL,
  requested_start_time TIME NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewer_note VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_flex_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_flex_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_flex_status (status, request_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS attachments (
  id CHAR(36) PRIMARY KEY,
  uploaded_by CHAR(36) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  object_key VARCHAR(500) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attachment_owner FOREIGN KEY (uploaded_by) REFERENCES employees(id),
  INDEX idx_attachment_owner (uploaded_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS leave_requests (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  leave_type ENUM('CASUAL','SICK','EARNED','FLOATING') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(5,2) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  attachment_id CHAR(36) NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewer_note VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_leave_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_leave_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_leave_employee_dates (employee_id, start_date, end_date),
  INDEX idx_leave_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS wfh_requests (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  request_date DATE NOT NULL,
  request_kind ENUM('PLANNED','EMERGENCY') NOT NULL DEFAULT 'PLANNED',
  reason VARCHAR(1000) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewer_note VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wfh_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_wfh_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  UNIQUE KEY uq_wfh_employee_day (employee_id, request_date),
  INDEX idx_wfh_status (status, request_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS temporary_exits (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  attendance_id CHAR(36) NOT NULL,
  left_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at DATETIME NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exit_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_exit_attendance FOREIGN KEY (attendance_id) REFERENCES attendance_records(id),
  INDEX idx_exit_open (employee_id, returned_at, left_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_holidays (
  holiday_date DATE PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_holiday_actor FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'UPDATE',
  entity_json JSON NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_notification_user_read (employee_id, read_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id CHAR(36) NULL,
  details_json JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_actor_action (actor_id, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
