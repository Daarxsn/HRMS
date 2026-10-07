-- Employee profile and organization metadata
ALTER TABLE employees
  ADD COLUMN branch VARCHAR(100) NOT NULL DEFAULT 'Pune',
  ADD COLUMN department VARCHAR(120) NOT NULL DEFAULT 'General',
  ADD COLUMN position VARCHAR(120) NOT NULL DEFAULT 'Employee',
  ADD COLUMN profile_photo_key VARCHAR(500) NULL,
  ADD COLUMN profile_photo_content_type VARCHAR(100) NULL,
  ADD COLUMN profile_photo_filename VARCHAR(255) NULL;
