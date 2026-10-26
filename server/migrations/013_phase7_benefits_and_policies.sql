ALTER TABLE employees
  ADD COLUMN date_of_birth DATE NULL;

ALTER TABLE leave_requests
  MODIFY COLUMN leave_type ENUM('CASUAL','SICK','EARNED','FLOATING','LEARNING') NOT NULL;

ALTER TABLE policy_acknowledgements
  ADD COLUMN user_agent VARCHAR(500) NULL;

ALTER TABLE company_policies
  MODIFY COLUMN created_by CHAR(36) NULL;

CREATE TABLE IF NOT EXISTS learning_allowances (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  fiscal_year INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  provider VARCHAR(120) NOT NULL,
  amount_inr DECIMAL(10,2) NOT NULL,
  invoice_attachment_id CHAR(36) NULL,
  notes VARCHAR(1000) NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  rejection_reason VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_learning_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_learning_attachment FOREIGN KEY (invoice_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
  CONSTRAINT fk_learning_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_learning_employee_year (employee_id, fiscal_year, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS leave_encashments (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  days DECIMAL(5,2) NOT NULL,
  reason VARCHAR(1000) NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  rejection_reason VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_encashment_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_encashment_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_encashment_employee (employee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS confidential_grievances (
  id CHAR(36) PRIMARY KEY,
  reference_code VARCHAR(32) NOT NULL UNIQUE,
  category ENUM('POSH','GOOD_SAMARITAN','GENERAL_GRIEVANCE') NOT NULL,
  subject VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  reporter_employee_id CHAR(36) NULL,
  reporter_name VARCHAR(120) NULL,
  reporter_email VARCHAR(254) NULL,
  status ENUM('OPEN','UNDER_INVESTIGATION','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  assigned_to_icc BOOLEAN NOT NULL DEFAULT TRUE,
  resolution_notes TEXT NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_grievance_reporter FOREIGN KEY (reporter_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_grievance_status (status, category),
  INDEX idx_grievance_reference (reference_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS birthday_passes (
  id CHAR(36) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  pass_date DATE NOT NULL,
  status ENUM('AVAILABLE','CLAIMED','EXPIRED') NOT NULL DEFAULT 'AVAILABLE',
  claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_birthday_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_birthday_pass (employee_id, pass_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO company_policies (id, title, category, version, body, status, published_at, created_by)
VALUES
('00000000-0000-4000-8000-000000000001', 'Code of Business Conduct & Ethics', 'ETHICS & GOVERNANCE', '2026.1', 'Falchion Xeniaa upholds the highest standards of professional and ethical integrity. Every employee must conduct business honestly, avoid conflicts of interest, reject all forms of bribery and corruption, and comply fully with applicable statutory laws and company standards. Any suspected violations must be reported promptly via official compliance channels.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000002', 'Equal Opportunity & Anti-Discrimination Policy', 'WORKPLACE CULTURE', '2026.1', 'Falchion Xeniaa is an Equal Opportunity Employer. We maintain zero tolerance for discrimination, bias, or harassment on grounds of race, color, religion, caste, sex, gender identity, sexual orientation, disability, marital status, or age. All employment decisions, promotions, and opportunities are grounded strictly in individual merit and performance.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000003', 'Attendance & Punctuality Policy', 'ATTENDANCE & OPERATIONS', '2026.1', 'Standard working hours are 09:00 AM to 06:00 PM, Monday through Saturday, with a fixed 30-minute lunch deduction. Check-ins up to 09:30 AM are on time; arrivals at or after 09:30 AM are recorded as late entry unless an approved flexible start is in place. Consistent shift adherence and transparent communication are expected across all departments.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000004', 'Remote Work & Flexibility Policy', 'ATTENDANCE & OPERATIONS', '2026.1', 'Falchion Xeniaa supports hybrid workplace agility. Employees may request Work From Home (up to 4 days per month with manager approval) or flexible morning start hours (up to 10:30 AM). Remote employees are expected to maintain active communication, secure network access, and standard productivity during business hours.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000005', 'Workplace Conduct & Etiquette Policy', 'WORKPLACE CULTURE', '2026.1', 'All personnel must treat colleagues, clients, and partners with dignity and professional courtesy. Disruptive behavior, offensive language, insubordination, and intimidation are strictly prohibited. Open collaboration, constructive disagreement, clean workspaces, and mutual accountability are core company values.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000006', 'Harassment & PoSH Compliance Policy', 'SAFETY & COMPLIANCE', '2026.1', 'In accordance with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, Falchion Xeniaa maintains an active Internal Complaints Committee (ICC). Any unwelcome physical, verbal, or non-verbal conduct of a sexual nature is strictly prohibited. Reports can be submitted confidentially or anonymously, with absolute protection against retaliation.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000007', 'Confidentiality & Data Protection Policy', 'SECURITY & PRIVACY', '2026.1', 'All proprietary information, customer records, technical intellectual property, financial metrics, and company documents must remain confidential. Unauthorized disclosure, copying, or personal use of corporate data is prohibited and subject to legal prosecution and immediate disciplinary action. Obligations survive cessation of employment.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000008', 'Use of Company Resources Policy', 'SECURITY & PRIVACY', '2026.1', 'Hardware, cloud services, software licenses, network bandwidth, and communication tools provided by Falchion Xeniaa are corporate property intended for legitimate business operations. Unauthorized software installation, commercial use for outside ventures, and storage of illegal or unauthorized content are grounds for revocation and sanction.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000009', 'Disciplinary Action Policy', 'GOVERNANCE & COMPLIANCE', '2026.1', 'Policy violations and performance deficiencies follow a structured, fair disciplinary framework: formal verbal warning, written reprimand, Performance Improvement Plan (PIP), suspension, or termination for cause. In cases of gross misconduct, theft, fraud, or harassment, the company reserves the right to terminate employment immediately.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000010', 'Substance-Free Workplace Policy', 'HEALTH & SAFETY', '2026.1', 'The manufacture, distribution, dispensing, possession, use, or being under the influence of illegal drugs or alcohol on company premises or during official business engagements is strictly forbidden. Smoking and vaping are prohibited inside all company buildings.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000011', 'Human Rights Policy', 'ETHICS & GOVERNANCE', '2026.1', 'Falchion Xeniaa respects universal human rights across all operations and partner networks. We prohibit forced, bonded, or involuntary prison labor, as well as child labor. We uphold fair compensation, safe working environments, reasonable working hours, and the fundamental right to human dignity.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000012', 'Learning & Development (L&D) Policy', 'BENEFITS & GROWTH', '2026.1', 'Falchion Xeniaa fosters continuous learning. Confirmed employees are provided an annual L&D budget of ₹2,000/month (up to ₹24,000 annually) for accredited courses, certifications, technical workshops, and books. Additionally, employees are entitled to up to 2 days per calendar quarter of dedicated Learning Time Off with manager approval.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000013', 'Recognition & Rewards Policy', 'BENEFITS & GROWTH', '2026.1', 'Excellence and exemplary contributions are celebrated through Spot Awards, Employee of the Quarter honors, Innovation Awards, and Service Milestone recognitions. Nominations are open to peers and managers, reviewed transparently by leadership, and awarded with formal company commendation and financial incentives.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL),
('00000000-0000-4000-8000-000000000014', 'Health, Safety & Wellness Policy', 'HEALTH & SAFETY', '2026.1', 'The physical health and mental well-being of our team is paramount. The company maintains ergonomic workstations, emergency response protocols, fire safety equipment, and comprehensive medical coverage. As a personal wellness benefit, employees are granted a Birthday Leave Pass allowing a 2-hour early sign-off on their birthday.', 'PUBLISHED', CURRENT_TIMESTAMP, NULL)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  category = VALUES(category),
  body = VALUES(body),
  status = VALUES(status);
