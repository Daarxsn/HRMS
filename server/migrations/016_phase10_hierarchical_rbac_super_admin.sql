-- Migration 016: Phase 10 4-Tier Hierarchical RBAC & Dynamic Role Management
-- Defect References: HRMS-DEF-044 (Role Inconsistency & Privilege Escalation Vulnerability)

-- 1. Extend employees.role ENUM to support 4-tier hierarchy: SUPER_ADMIN, ADMIN, EMPLOYEE, INTERN
ALTER TABLE employees 
  MODIFY COLUMN role ENUM('SUPER_ADMIN','ADMIN','EMPLOYEE','INTERN') NOT NULL DEFAULT 'EMPLOYEE';

-- 2. Extend employees.user_type ENUM to match authoritative 4-tier hierarchy
ALTER TABLE employees 
  MODIFY COLUMN user_type ENUM('SUPER_ADMIN','ADMIN','EMPLOYEE','INTERN') NOT NULL DEFAULT 'EMPLOYEE';

-- 3. Promote primary founding administrator Om Shah to SUPER_ADMIN
UPDATE employees 
SET role = 'SUPER_ADMIN', user_type = 'SUPER_ADMIN' 
WHERE email = 'om.admin@example.test';

-- 4. In production environments where om.admin@example.test does not exist, promote the earliest active ADMIN
UPDATE employees 
SET role = 'SUPER_ADMIN', user_type = 'SUPER_ADMIN' 
WHERE id = (
  SELECT id FROM (
    SELECT id FROM employees WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY joined_on ASC, id ASC LIMIT 1
  ) AS founding_admin
) AND NOT EXISTS (
  SELECT 1 FROM (SELECT id FROM employees WHERE role = 'SUPER_ADMIN') AS existing_super_admin
);

-- 5. Normalize existing intern records
UPDATE employees 
SET role = 'INTERN' 
WHERE user_type = 'INTERN' AND role = 'EMPLOYEE';

-- 6. Add composite index on (status, user_type) for workforce queries
SET @idx_emp_status_user_type = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'employees' AND index_name = 'idx_employees_status_user_type'
);
SET @sql_emp_status_user_type = IF(@idx_emp_status_user_type = 0,
  'ALTER TABLE employees ADD INDEX idx_employees_status_user_type (status, user_type)',
  'SELECT 1'
);
PREPARE stmt_emp_status_user_type FROM @sql_emp_status_user_type;
EXECUTE stmt_emp_status_user_type;
DEALLOCATE PREPARE stmt_emp_status_user_type;
