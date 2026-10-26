-- Seed baseline system settings required for attendance, geofence, and leave policies
INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('office_name', 'Falchion Xeniaa Pune HQ'),
  ('office_latitude', '18.506633'),
  ('office_longitude', '73.857692'),
  ('geofence_meters', '80'),
  ('standard_start', '09:00'),
  ('standard_end', '18:00'),
  ('late_threshold', '09:30'),
  ('fixed_lunch_minutes', '30'),
  ('gps_max_accuracy_meters', '100'),
  ('wfh_monthly_cap', '4'),
  ('leave_casual_sl_entitlement', '8'),
  ('leave_earned_entitlement', '15'),
  ('leave_earned_monthly_accrual', '1'),
  ('leave_floating_entitlement', '4')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
