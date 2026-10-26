import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isBirthdayToday,
  calculateTenureMonths,
  isEligibleForLeaveEncashment,
  indiaDate
} from '../src/policy.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration013 = fs.readFileSync(path.resolve(here, '../migrations/013_phase7_benefits_and_policies.sql'), 'utf8');
const enterpriseRoutes = fs.readFileSync(path.resolve(here, '../src/routes/enterprise.mts'), 'utf8');
const leaveRoutes = fs.readFileSync(path.resolve(here, '../src/routes/leave.mts'), 'utf8');
const attendanceRoutes = fs.readFileSync(path.resolve(here, '../src/routes/attendance.mts'), 'utf8');

test('Birthday pass: isBirthdayToday detects birth dates matching today in IST', () => {
  const today = indiaDate();
  const [year, month, day] = today.split('-');
  const birthYear = String(Number(year) - 25);
  const matchingDob = `${birthYear}-${month}-${day}`;
  const nonMatchingDob = `${birthYear}-01-01` === today ? `${birthYear}-12-31` : `${birthYear}-01-01`;

  assert.equal(isBirthdayToday(matchingDob), true);
  assert.equal(isBirthdayToday(nonMatchingDob), false);
  assert.equal(isBirthdayToday(null), false);
  assert.equal(isBirthdayToday(undefined), false);
  assert.equal(isBirthdayToday('invalid-date'), false);
});

test('Leave encashment: calculateTenureMonths and eligibility enforce 12-month tenure policy', () => {
  const asOf = new Date('2026-10-26T12:00:00Z');
  // Joined 18 months ago -> eligible
  assert.equal(calculateTenureMonths('2025-04-26', asOf), 18);
  assert.equal(isEligibleForLeaveEncashment('2025-04-26', 10, asOf), true);

  // Joined 6 months ago -> not eligible
  assert.equal(calculateTenureMonths('2026-04-26', asOf), 6);
  assert.equal(isEligibleForLeaveEncashment('2026-04-26', 10, asOf), false);

  // Joined 12 months ago with 0 earned balance -> not eligible
  assert.equal(calculateTenureMonths('2025-10-26', asOf), 12);
  assert.equal(isEligibleForLeaveEncashment('2025-10-26', 0, asOf), false);

  // Joined 12 months ago with >=1 earned balance -> eligible
  assert.equal(isEligibleForLeaveEncashment('2025-10-26', 5, asOf), true);
});

test('Phase 7 migration 013 seeds 14 official policies and required schema tables', () => {
  assert.match(migration013, /CREATE TABLE IF NOT EXISTS learning_allowances/);
  assert.match(migration013, /CREATE TABLE IF NOT EXISTS leave_encashments/);
  assert.match(migration013, /CREATE TABLE IF NOT EXISTS confidential_grievances/);
  assert.match(migration013, /CREATE TABLE IF NOT EXISTS birthday_passes/);
  assert.match(migration013, /ALTER TABLE policy_acknowledgements\s+ADD COLUMN user_agent/);
  assert.match(migration013, /ENUM\('CASUAL','SICK','EARNED','FLOATING','LEARNING'\)/);

  // Verify all 14 official policy documents are seeded
  const expectedPolicies = [
    'Code of Business Conduct & Ethics',
    'Equal Opportunity & Anti-Discrimination Policy',
    'Attendance & Punctuality Policy',
    'Remote Work & Flexibility Policy',
    'Workplace Conduct & Etiquette Policy',
    'Harassment & PoSH Compliance Policy',
    'Confidentiality & Data Protection Policy',
    'Use of Company Resources Policy',
    'Disciplinary Action Policy',
    'Substance-Free Workplace Policy',
    'Human Rights Policy',
    'Learning & Development (L&D) Policy',
    'Recognition & Rewards Policy',
    'Health, Safety & Wellness Policy'
  ];

  for (const title of expectedPolicies) {
    assert.ok(migration013.includes(title), `Migration 013 must include official policy: ${title}`);
  }
});

test('Phase 7 Backend API contracts: Enterprise benefits and grievance channels', () => {
  // L&D Budget & Claims
  assert.match(enterpriseRoutes, /router\.get\('\/learning\/budget'/);
  assert.match(enterpriseRoutes, /router\.post\('\/learning\/claims'/);
  assert.match(enterpriseRoutes, /router\.get\('\/admin\/learning\/claims'/);
  assert.match(enterpriseRoutes, /router\.post\('\/admin\/learning\/claims\/:id\/review'/);
  assert.match(enterpriseRoutes, /annualAllowance\s*=\s*24000/);

  // Birthday Pass
  assert.match(enterpriseRoutes, /router\.get\('\/birthday-pass'/);
  assert.match(enterpriseRoutes, /router\.post\('\/birthday-pass\/claim'/);
  assert.match(attendanceRoutes, /birthday_pass_applied/);

  // Confidential Grievances & PoSH
  assert.match(enterpriseRoutes, /router\.post\('\/grievances'/);
  assert.match(enterpriseRoutes, /router\.get\('\/grievances\/track\/:code'/);
  assert.match(enterpriseRoutes, /router\.get\('\/admin\/grievances'/);
  assert.match(enterpriseRoutes, /router\.patch\('\/admin\/grievances\/:id'/);
  assert.match(enterpriseRoutes, /FX-GRIEV-/);
  assert.match(enterpriseRoutes, /assigned_to_icc/);

  // Digital Signature & User-Agent capture
  assert.match(enterpriseRoutes, /user_agent/);
  assert.match(enterpriseRoutes, /router\.get\('\/admin\/policies\/:id\/acknowledgements'/);
});

test('Phase 7 Backend API contracts: Learning Leave & Encashment Workflows', () => {
  // Learning Time Off
  assert.match(leaveRoutes, /'LEARNING'/);
  assert.match(leaveRoutes, /Learning Time Off is capped at 2 days per calendar quarter/);

  // Earned Leave Encashment
  assert.match(leaveRoutes, /router\.get\('\/encashment\/eligibility'/);
  assert.match(leaveRoutes, /router\.post\('\/encashment'/);
  assert.match(leaveRoutes, /router\.get\('\/encashments'/);
  assert.match(leaveRoutes, /router\.get\('\/admin\/encashments'/);
  assert.match(leaveRoutes, /router\.post\('\/admin\/encashments\/:id\/review'/);
  assert.match(leaveRoutes, /minimum of 12 months continuous service/);
});
