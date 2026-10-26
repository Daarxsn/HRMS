CREATE TABLE IF NOT EXISTS employee_sessions (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  session_token_hash CHAR(64) NOT NULL UNIQUE,
  device_name VARCHAR(120) NOT NULL,
  user_agent VARCHAR(500) NULL,
  ip_address VARCHAR(45) NULL,
  is_remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  CONSTRAINT fk_sessions_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_sessions_employee_active (employee_id, revoked_at, expires_at),
  INDEX idx_sessions_hash (session_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
