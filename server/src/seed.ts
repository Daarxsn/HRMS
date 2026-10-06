import 'dotenv/config';
import crypto from 'node:crypto';
import { pool } from './db.ts';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Database seeding is disabled in production. Use approved production migrations and real employee provisioning instead.');
}

const people = [
  ['FX-0001','Om Shah','om.admin@example.test','ADMIN','ADMIN','Founder & administrator',false],
  ['FX-0002','Aarav Mehta','aarav.mehta@example.test','EMPLOYEE','EMPLOYEE','Product designer',true],
  ['FX-0003','Priya Shah','priya.shah@example.test','EMPLOYEE','EMPLOYEE','People operations',false],
  ['FX-0004','Kabir Joshi','kabir.joshi@example.test','EMPLOYEE','EMPLOYEE','Software engineer',false],
  ['FX-0005','Anaya Patel','anaya.patel@example.test','EMPLOYEE','EMPLOYEE','Customer success',false],
  ['FX-0006','Ishaan Kulkarni','ishaan.kulkarni@example.test','EMPLOYEE','EMPLOYEE','Operations associate',false],
  ['FX-0007','Mira Desai','mira.desai@example.test','EMPLOYEE','EMPLOYEE','Marketing associate',false],
  ['FX-0008','Rohan Nair','rohan.nair@example.test','EMPLOYEE','EMPLOYEE','Engineering intern',false],
  ['FX-0009','Sana Khan','sana.khan@example.test','INTERN','EMPLOYEE','Design intern',false],
  ['FX-0010','Dev Malhotra','dev.malhotra@example.test','INTERN','EMPLOYEE','Business intern',false],
  ['FX-0011','Tara Rao','tara.rao@example.test','INTERN','EMPLOYEE','Operations intern',false]
];

try {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = new Map();
    for (const [code, name, email, type, role, title, wfh] of people) {
      const id = crypto.randomUUID();
      await connection.execute(`INSERT INTO employees (id, employee_code, full_name, email, role, user_type, status, title, joined_on, probation_end_date, wfh_enabled)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, '2025-01-06', '2025-04-06', ?)
        ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), role=VALUES(role), user_type=VALUES(user_type), title=VALUES(title), wfh_enabled=VALUES(wfh_enabled)`,
      [id, code, name, email, role, type, title, wfh]);
      const [found] = await connection.execute('SELECT id FROM employees WHERE email=?', [email]);
      ids.set(email, found[0].id);
    }
    const defaults = {
      office_name:'Falchion Xeniaa Pune HQ', office_latitude:'18.506633', office_longitude:'73.857692', geofence_meters:'80',
      standard_start:'09:00', standard_end:'18:00', late_threshold:'09:30', fixed_lunch_minutes:'30', gps_max_accuracy_meters:'100', wfh_monthly_cap:'4', leave_casual_sl_entitlement:'8', leave_earned_entitlement:'15',
      leave_earned_monthly_accrual:'1', leave_floating_entitlement:'4'
    };
    for (const [key, value] of Object.entries(defaults)) {
      await connection.execute('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_key=VALUES(setting_key)', [key,value]);
    }
    const adminId = ids.get('om.admin@example.test');
    for (const [month, day, label] of [[1,26,'Republic Day'],[8,15,'Independence Day'],[10,2,'Gandhi Jayanti']]) {
      const date = `2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      await connection.execute('INSERT IGNORE INTO company_holidays (holiday_date, name, created_by) VALUES (?, ?, ?)', [date,label,adminId]);
    }
    await connection.commit();
    console.log(`Seeded ${people.length - 1} employee/intern accounts and one administrator. Demo sign-in is development-only.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
} finally { await pool.end(); }
