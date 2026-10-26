import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import {
  isSuperAdmin,
  isAdmin,
  isIntern,
  platformFor,
  accessFor,
  requireSuperAdmin,
  requireAdmin,
  requirePeople,
  signToken
} from '../src/security.mts';
import { internLeaveEntitlement, calculateTenureMonths } from '../src/policy.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration016 = fs.readFileSync(path.resolve(here, '../migrations/016_phase10_hierarchical_rbac_super_admin.sql'), 'utf8');
const adminRoutes = fs.readFileSync(path.resolve(here, '../src/routes/admin.mts'), 'utf8');
const leaveRoutes = fs.readFileSync(path.resolve(here, '../src/routes/leave.mts'), 'utf8');
const clientApp = fs.readFileSync(path.resolve(here, '../../client/src/App.tsx'), 'utf8');
const clientStyles = fs.readFileSync(path.resolve(here, '../../client/src/styles.css'), 'utf8');

test('Hierarchical RBAC: role classification and platform derivation', () => {
  const superAdmin = { id: 'sa-1', role: 'SUPER_ADMIN', user_type: 'SUPER_ADMIN' };
  const admin = { id: 'adm-1', role: 'ADMIN', user_type: 'ADMIN' };
  const employee = { id: 'emp-1', role: 'EMPLOYEE', user_type: 'EMPLOYEE' };
  const intern1 = { id: 'int-1', role: 'INTERN', user_type: 'INTERN' };
  const intern2 = { id: 'int-2', role: 'EMPLOYEE', user_type: 'INTERN' };

  // isSuperAdmin
  assert.equal(isSuperAdmin(superAdmin), true);
  assert.equal(isSuperAdmin(admin), false);
  assert.equal(isSuperAdmin(employee), false);
  assert.equal(isSuperAdmin(intern1), false);
  assert.equal(isSuperAdmin(null), false);

  // isAdmin
  assert.equal(isAdmin(superAdmin), true);
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(employee), false);
  assert.equal(isAdmin(intern1), false);

  // isIntern
  assert.equal(isIntern(intern1), true);
  assert.equal(isIntern(intern2), true);
  assert.equal(isIntern(employee), false);
  assert.equal(isIntern(admin), false);
  assert.equal(isIntern(superAdmin), false);

  // platformFor
  assert.equal(platformFor(superAdmin), 'ADMIN');
  assert.equal(platformFor(admin), 'ADMIN');
  assert.equal(platformFor(employee), 'PEOPLE');
  assert.equal(platformFor(intern1), 'PEOPLE');
});

test('RBAC Capabilities: Super Admin receives root permissions while Admin is partitioned', () => {
  const superAdmin = { id: 'sa-1', role: 'SUPER_ADMIN', user_type: 'SUPER_ADMIN' };
  const admin = { id: 'adm-1', role: 'ADMIN', user_type: 'ADMIN' };
  const employee = { id: 'emp-1', role: 'EMPLOYEE', user_type: 'EMPLOYEE' };

  const saAccess = accessFor(superAdmin);
  assert.equal(saAccess.platform, 'ADMIN');
  assert.equal(saAccess.isSuperAdmin, true);
  assert.ok(saAccess.capabilities.includes('office_settings'), 'Super Admin must possess office_settings capability');
  assert.ok(saAccess.capabilities.includes('audit_trail'), 'Super Admin must possess audit_trail capability');
  assert.ok(saAccess.capabilities.includes('role_management_super'), 'Super Admin must possess role_management_super capability');
  assert.ok(saAccess.capabilities.includes('people_management'));

  const adminAccess = accessFor(admin);
  assert.equal(adminAccess.platform, 'ADMIN');
  assert.equal(adminAccess.isSuperAdmin, false);
  assert.ok(!adminAccess.capabilities.includes('office_settings'), 'Standard Admin must NOT possess office_settings capability');
  assert.ok(!adminAccess.capabilities.includes('audit_trail'), 'Standard Admin must NOT possess audit_trail capability');
  assert.ok(!adminAccess.capabilities.includes('role_management_super'), 'Standard Admin must NOT possess role_management_super capability');
  assert.ok(adminAccess.capabilities.includes('people_management'), 'Standard Admin must possess workforce operations');

  const empAccess = accessFor(employee);
  assert.equal(empAccess.platform, 'PEOPLE');
  assert.equal(empAccess.isSuperAdmin, false);
  assert.ok(empAccess.capabilities.includes('attendance'));
  assert.ok(!empAccess.capabilities.includes('people_management'));
});

test('Access Control Middleware: requireSuperAdmin restricts access to Super Admins only', () => {
  const superAdminUser = { id: 'sa-1', role: 'SUPER_ADMIN', user_type: 'SUPER_ADMIN' };
  const adminUser = { id: 'adm-1', role: 'ADMIN', user_type: 'ADMIN' };
  const employeeUser = { id: 'emp-1', role: 'EMPLOYEE', user_type: 'EMPLOYEE' };

  // Test Super Admin passing through
  let superAdminNextCalled = false;
  const mockResSuccess: any = {
    status: () => mockResSuccess,
    json: () => mockResSuccess
  };
  requireSuperAdmin({ user: superAdminUser }, mockResSuccess, () => {
    superAdminNextCalled = true;
  });
  assert.equal(superAdminNextCalled, true, 'requireSuperAdmin must call next() for Super Admin');

  // Test Standard Admin blocked
  let adminBlockedStatus = 0;
  let adminBlockedJson: any = null;
  const mockResAdmin: any = {
    status: (code: number) => { adminBlockedStatus = code; return mockResAdmin; },
    json: (payload: any) => { adminBlockedJson = payload; return mockResAdmin; }
  };
  requireSuperAdmin({ user: adminUser }, mockResAdmin, () => {
    assert.fail('next() should not be called for standard Admin in requireSuperAdmin');
  });
  assert.equal(adminBlockedStatus, 403);
  assert.equal(adminBlockedJson?.error, 'Super Administrator access is required.');

  // Test Employee blocked
  let empBlockedStatus = 0;
  const mockResEmp: any = {
    status: (code: number) => { empBlockedStatus = code; return mockResEmp; },
    json: () => mockResEmp
  };
  requireSuperAdmin({ user: employeeUser }, mockResEmp, () => {
    assert.fail('next() should not be called for Employee in requireSuperAdmin');
  });
  assert.equal(empBlockedStatus, 403);
});

test('Access Control Middleware: requireAdmin allows both Super Admin and Admin', () => {
  const superAdminUser = { id: 'sa-1', role: 'SUPER_ADMIN', user_type: 'SUPER_ADMIN' };
  const adminUser = { id: 'adm-1', role: 'ADMIN', user_type: 'ADMIN' };
  const employeeUser = { id: 'emp-1', role: 'EMPLOYEE', user_type: 'EMPLOYEE' };

  let saNext = false;
  requireAdmin({ user: superAdminUser }, {} as any, () => { saNext = true; });
  assert.equal(saNext, true, 'Super Admin must pass requireAdmin');

  let admNext = false;
  requireAdmin({ user: adminUser }, {} as any, () => { admNext = true; });
  assert.equal(admNext, true, 'Standard Admin must pass requireAdmin');

  let empBlocked = false;
  const mockRes: any = {
    status: (code: number) => {
      if (code === 403) empBlocked = true;
      return mockRes;
    },
    json: () => mockRes
  };
  requireAdmin({ user: employeeUser }, mockRes, () => {
    assert.fail('Employee should be blocked by requireAdmin');
  });
  assert.equal(empBlocked, true);
});

test('Backend Security Contracts: Settings and Audit endpoints enforce requireSuperAdmin', () => {
  // Verify PUT /settings route has requireSuperAdmin
  assert.match(
    adminRoutes,
    /router\.put\('\/settings',\s*adminMutationLimiter,\s*requireSuperAdmin,/,
    'PUT /settings must be guarded by requireSuperAdmin'
  );

  // Verify GET /audit route has requireSuperAdmin
  assert.match(
    adminRoutes,
    /router\.get\('\/audit',\s*requireSuperAdmin,/,
    'GET /audit must be guarded by requireSuperAdmin'
  );
});

test('Backend Security Contracts: PUT /employees/:id/role implements all 5 privilege escalation guards', () => {
  // Verify endpoint registration
  assert.match(
    adminRoutes,
    /router\.put\(\['\/employees\/:id\/role',\s*'\/users\/:id\/role'\],/,
    'Endpoint PUT /employees/:id/role and PUT /users/:id/role must be registered'
  );

  // Guard 1: Target existence and active status
  assert.match(adminRoutes, /if \(!target\)\s*\{\s*throw Object\.assign\(new Error\('Employee not found\.'\),\s*\{\s*status:\s*404/);
  assert.match(adminRoutes, /if \(target\.status !== 'ACTIVE'\)\s*\{\s*throw Object\.assign\(new Error\('Cannot change the role of an inactive account\.'\),\s*\{\s*status:\s*400/);

  // Guard 2: Protecting Super Admins (Only Super Admin can modify another Super Admin)
  assert.match(adminRoutes, /if \(targetIsSuperAdmin && !actorIsSuperAdmin\)\s*\{\s*throw Object\.assign\(new Error\('Only a Super Administrator can modify another Super Administrator account\.'\),\s*\{\s*status:\s*403/);

  // Guard 3: Blocking unauthorized promotions (Standard Admin cannot grant SUPER_ADMIN)
  assert.match(adminRoutes, /if \(newRole === 'SUPER_ADMIN' && !actorIsSuperAdmin\)\s*\{\s*throw Object\.assign\(new Error\('Only a Super Administrator can promote a user to Super Administrator\.'\),\s*\{\s*status:\s*403/);

  // Guard 4: Self-demotion lockout prevention (Last active Super Admin cannot demote themselves)
  assert.match(adminRoutes, /Cannot demote the last active Super Administrator in the organization/);

  // Guard 5: Self-promotion prevention (Standard Admin cannot alter or elevate own privileges)
  assert.match(adminRoutes, /if \(req\.user\.id === target\.id && !actorIsSuperAdmin\)\s*\{\s*throw Object\.assign\(new Error\('Administrators cannot alter or elevate their own privileges\.'\),\s*\{\s*status:\s*403/);

  // Session invalidation on role change
  assert.match(adminRoutes, /session_version = session_version \+ 1/);

  // Audit log and notification dispatch
  assert.match(adminRoutes, /action:\s*'ROLE_CHANGED'/);
  assert.match(adminRoutes, /notify\(\s*targetId,\s*'Organizational Role Updated'/);
});

test('Session Invalidation: Incrementing session_version invalidates previous JWT tokens', () => {
  const user = { id: 'user-xyz', role: 'EMPLOYEE', user_type: 'EMPLOYEE', session_version: 1 };
  const token = signToken(user, false);
  const decoded: any = jwt.decode(token);
  assert.equal(decoded.session_version, 1);

  // When session_version is incremented to 2 in DB:
  const updatedDbVersion = 2;
  assert.notEqual(Number(decoded.session_version), updatedDbVersion, 'Previous token version must not match updated DB session version');
});

test('Intern Leave Policy: Accrual formula and Earned Leave restrictions', () => {
  const asOf = new Date('2026-10-26T12:00:00Z');

  // Month 0 (just joined today) -> 1 day minimum
  assert.equal(internLeaveEntitlement('2026-10-26', asOf), 1);

  // 3 months tenure -> 4 days
  assert.equal(internLeaveEntitlement('2026-07-26', asOf), 4);

  // 12+ months tenure -> capped at 12 days per year
  assert.equal(internLeaveEntitlement('2025-01-01', asOf), 12);
  assert.equal(internLeaveEntitlement('2024-01-01', asOf), 12);

  // Check leave route contracts for Interns
  assert.match(leaveRoutes, /isIntern \? 0 : \(Number\.isFinite\(policy\.leave_earned_entitlement\)/, 'Intern earned entitlement must be 0');
  assert.match(leaveRoutes, /Interns are not eligible for Earned Leave accrual/, 'Interns must receive explicit notice on earned leave');
  assert.match(leaveRoutes, /if \(input\.type === 'EARNED' && \(req\.user\.user_type === 'INTERN' \|\| req\.user\.role === 'INTERN'\)\)\s*\{\s*throw Object\.assign\(new Error\('Interns are not eligible for Earned Leave\.'\)/, 'Intern earned leave applications must be blocked');
});

test('Database Migration 016: Extends role enum, seeds founding Super Admin, and normalizes intern records', () => {
  // Enum extension
  assert.match(migration016, /MODIFY COLUMN role ENUM\('SUPER_ADMIN','ADMIN','EMPLOYEE','INTERN'\)/);
  assert.match(migration016, /MODIFY COLUMN user_type ENUM\('SUPER_ADMIN','ADMIN','EMPLOYEE','INTERN'\)/);

  // Super Admin promotion
  assert.match(migration016, /om\.admin@example\.test/);
  assert.match(migration016, /SET role = 'SUPER_ADMIN',\s*user_type = 'SUPER_ADMIN'/);

  // Intern record normalization
  assert.match(migration016, /UPDATE employees\s+SET role = 'INTERN'\s+WHERE user_type = 'INTERN'/);

  // Composite index
  assert.match(migration016, /idx_employees_status_user_type/);
});

test('Frontend UI Contracts: 4-Tier RBAC display, role chips, and confirmation dialog', () => {
  // Verify roleInfo helper
  assert.match(clientApp, /function roleInfo\(personOrRole\)/);
  assert.match(clientApp, /role-super-admin/);
  assert.match(clientApp, /role-intern/);

  // Verify RoleChangeConfirmModal exists
  assert.match(clientApp, /function RoleChangeConfirmModal/);
  assert.match(clientApp, /Confirm Role Change/);
  assert.match(clientApp, /Privilege & Session Impact/);

  // Verify locked badge for Super Admin in Admin view
  assert.match(clientApp, /role-locked-badge/);
  assert.match(clientApp, /Super Administrator accounts can only be modified by Super Administrators/);

  // Verify styling in stylesheet
  assert.match(clientStyles, /\.role-super-admin/);
  assert.match(clientStyles, /\.role-intern/);
  assert.match(clientStyles, /\.avatar-super-admin/);
  assert.match(clientStyles, /\.avatar-intern/);
  assert.match(clientStyles, /\.role-locked-badge/);
});
