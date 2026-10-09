CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
  id CHAR(36) PRIMARY KEY, employee_id CHAR(36) NOT NULL, contact_name VARCHAR(120) NOT NULL,
  relationship VARCHAR(80) NOT NULL, phone VARCHAR(32) NOT NULL, email VARCHAR(254) NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_emergency_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_emergency_employee (employee_id, is_primary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS employment_history (
  id CHAR(36) PRIMARY KEY, employee_id CHAR(36) NOT NULL,
  event_type ENUM('JOINED','PROMOTED','TRANSFERRED','ROLE_CHANGED','PROBATION_COMPLETED','STATUS_CHANGED','OTHER') NOT NULL,
  effective_date DATE NOT NULL, title VARCHAR(120) NULL, department VARCHAR(120) NULL, branch VARCHAR(100) NULL,
  notes VARCHAR(1000) NULL, created_by CHAR(36) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_employment_history_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_employment_history_creator FOREIGN KEY (created_by) REFERENCES employees(id),
  INDEX idx_employment_history_employee_date (employee_id, effective_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id CHAR(36) PRIMARY KEY, employee_id CHAR(36) NOT NULL, title VARCHAR(180) NOT NULL, category VARCHAR(80) NOT NULL DEFAULT 'GENERAL',
  due_date DATE NULL, status ENUM('PENDING','IN_PROGRESS','COMPLETED','BLOCKED') NOT NULL DEFAULT 'PENDING',
  completed_at DATETIME NULL, completed_by CHAR(36) NULL, notes VARCHAR(1000) NULL, created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_onboarding_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_onboarding_completed_by FOREIGN KEY (completed_by) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_onboarding_creator FOREIGN KEY (created_by) REFERENCES employees(id),
  INDEX idx_onboarding_employee_status (employee_id, status, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS employee_documents (
  id CHAR(36) PRIMARY KEY, employee_id CHAR(36) NOT NULL, document_type VARCHAR(80) NOT NULL, title VARCHAR(180) NOT NULL,
  description VARCHAR(1000) NULL, object_key VARCHAR(500) NULL, original_filename VARCHAR(255) NULL, content_type VARCHAR(120) NULL,
  size_bytes INT UNSIGNED NULL, issued_on DATE NULL, expires_on DATE NULL,
  status ENUM('ACTIVE','EXPIRING','EXPIRED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  uploaded_by CHAR(36) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_document_uploader FOREIGN KEY (uploaded_by) REFERENCES employees(id),
  INDEX idx_document_employee_expiry (employee_id, expires_on, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_assets (
  id CHAR(36) PRIMARY KEY, asset_tag VARCHAR(80) NOT NULL UNIQUE, name VARCHAR(180) NOT NULL, category VARCHAR(80) NOT NULL,
  serial_number VARCHAR(160) NULL, status ENUM('AVAILABLE','ASSIGNED','REPAIR','RETIRED') NOT NULL DEFAULT 'AVAILABLE',
  assigned_employee_id CHAR(36) NULL, assigned_at DATETIME NULL, returned_at DATETIME NULL, notes VARCHAR(1000) NULL,
  created_by CHAR(36) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_asset_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_asset_creator FOREIGN KEY (created_by) REFERENCES employees(id),
  INDEX idx_asset_status_employee (status, assigned_employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_policies (
  id CHAR(36) PRIMARY KEY, title VARCHAR(180) NOT NULL, category VARCHAR(80) NOT NULL, version VARCHAR(40) NOT NULL, body TEXT NOT NULL,
  status ENUM('DRAFT','PUBLISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT', published_at DATETIME NULL, created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_policy_creator FOREIGN KEY (created_by) REFERENCES employees(id),
  INDEX idx_policy_status (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id CHAR(36) PRIMARY KEY, policy_id CHAR(36) NOT NULL, employee_id CHAR(36) NOT NULL, acknowledged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45) NULL, CONSTRAINT fk_policy_ack_policy FOREIGN KEY (policy_id) REFERENCES company_policies(id) ON DELETE CASCADE,
  CONSTRAINT fk_policy_ack_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_policy_employee_ack (policy_id, employee_id), INDEX idx_policy_ack_employee (employee_id, acknowledged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS separation_cases (
  id CHAR(36) PRIMARY KEY, employee_id CHAR(36) NOT NULL,
  separation_type ENUM('RESIGNATION','TERMINATION','CONTRACT_END','RETIREMENT','OTHER') NOT NULL,
  reason VARCHAR(1000) NULL, last_working_date DATE NOT NULL, status ENUM('OPEN','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  notes VARCHAR(2000) NULL, created_by CHAR(36) NOT NULL, completed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_separation_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_separation_creator FOREIGN KEY (created_by) REFERENCES employees(id),
  INDEX idx_separation_status_date (status, last_working_date), INDEX idx_separation_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Backfill a durable joined event for employees that already existed before Phase 44.
INSERT INTO employment_history (id,employee_id,event_type,effective_date,title,department,branch,notes,created_by)
SELECT UUID(), e.id, 'JOINED', e.joined_on, e.title, e.department, e.branch,
       'Backfilled from the existing employee record.',
       (SELECT id FROM employees WHERE role='ADMIN' AND status='ACTIVE' ORDER BY created_at, id LIMIT 1)
FROM employees e
WHERE NOT EXISTS (
  SELECT 1 FROM employment_history h
  WHERE h.employee_id=e.id AND h.event_type='JOINED' AND h.effective_date=e.joined_on
);
