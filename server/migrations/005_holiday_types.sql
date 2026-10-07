ALTER TABLE company_holidays
  ADD COLUMN holiday_kind ENUM('FIXED','FLOATING') NOT NULL DEFAULT 'FIXED' AFTER name;

UPDATE company_holidays
SET holiday_kind='FIXED'
WHERE holiday_kind IS NULL OR holiday_kind='FIXED';

INSERT INTO company_holidays (holiday_date, name, holiday_kind)
VALUES
  ('2026-01-14','Makar Sankranti','FLOATING'),
  ('2026-03-04','Holi','FLOATING'),
  ('2026-03-21','Eid al-Fitr (Ramzan Id)','FLOATING'),
  ('2026-04-03','Good Friday','FLOATING'),
  ('2026-05-01','Buddha Purnima','FLOATING'),
  ('2026-06-26','Muharram','FLOATING'),
  ('2026-08-28','Raksha Bandhan','FLOATING'),
  ('2026-09-04','Janmashtami','FLOATING'),
  ('2026-09-14','Ganesh Chaturthi (Ganapati)','FLOATING'),
  ('2026-10-20','Dussehra','FLOATING'),
  ('2026-11-08','Diwali','FLOATING'),
  ('2026-12-25','Christmas','FLOATING')
ON DUPLICATE KEY UPDATE name=VALUES(name), holiday_kind=VALUES(holiday_kind);
