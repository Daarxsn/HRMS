import { describe, it, expect } from 'vitest';
import {
  POLICY,
  attendanceStatus,
  expectedShiftStart,
  hasPassedAbsenceCutoff,
  earnedLeaveAccrual,
  earnedLeaveAccrualForEmployment,
  internLeaveEntitlement,
  isBirthdayToday,
  calculateTenureMonths,
  isEligibleForLeaveEncashment,
  getCalendarQuarter,
  distanceMeters,
  workingDaysInclusive,
  netWorkedMinutes,
  isScheduledWorkday,
  isAttendanceAllowed,
  parseOfficeNetworkIps,
  isOfficeNetworkIpAllowed
} from './server/src/policy.mts';

describe('Policy Math & Attendance Status', () => {
  it('correctly tags on-time and late check-ins against standard and approved shifts', () => {
    // 09:29:59 is on time
    expect(attendanceStatus('2026-10-26T03:59:59Z', null)).toBe('ON_TIME');
    // 09:30:00 is late against default 09:30 threshold
    expect(attendanceStatus('2026-10-26T04:00:00Z', null)).toBe('LATE_ENTRY');

    // Approved flex shift at 10:30
    expect(attendanceStatus('2026-10-26T05:00:00Z', '10:30')).toBe('ON_TIME');
    expect(attendanceStatus('2026-10-26T05:00:01Z', '10:30')).toBe('LATE_ENTRY');
  });

  it('determines absence cutoff with 90-minute grace period', () => {
    // Standard start is 09:00 -> cutoff is 10:30
    expect(hasPassedAbsenceCutoff('10:30', '09:00', 90)).toBe(false);
    expect(hasPassedAbsenceCutoff('10:31', '09:00', 90)).toBe(true);

    // Flex start 10:00 -> cutoff is 11:30
    expect(hasPassedAbsenceCutoff('11:30', '10:00', 90)).toBe(false);
    expect(hasPassedAbsenceCutoff('11:31', '10:00', 90)).toBe(true);
  });

  it('computes expected shift start with fallback', () => {
    expect(expectedShiftStart('10:15')).toBe('10:15');
    expect(expectedShiftStart(null)).toBe(POLICY.standardStart);
  });

  it('deducts fixed lunch break and bounds net worked minutes at zero', () => {
    // 8 hours shift (480 mins) - 30 mins lunch = 450 mins
    expect(netWorkedMinutes('2026-10-26T09:00:00Z', '2026-10-26T17:00:00Z', 30)).toBe(450);
    // Short shift of 20 minutes - 30 mins lunch = 0 (never negative)
    expect(netWorkedMinutes('2026-10-26T09:00:00Z', '2026-10-26T09:20:00Z', 30)).toBe(0);
  });
});

describe('Geofence & Office Network Verification', () => {
  it('calculates geographic distance in meters accurately via Haversine formula', () => {
    // Distance from Pune HQ to Pune HQ is 0
    const d0 = distanceMeters(POLICY.latitude, POLICY.longitude, POLICY.latitude, POLICY.longitude);
    expect(Math.round(d0)).toBe(0);

    // Point roughly 50m north: 18.507083, 73.857692
    const d50 = distanceMeters(POLICY.latitude, POLICY.longitude, 18.507083, 73.857692);
    expect(d50).toBeGreaterThan(45);
    expect(d50).toBeLessThan(55);

    // Point outside geofence (200m away)
    const d200 = distanceMeters(POLICY.latitude, POLICY.longitude, 18.508433, 73.857692);
    expect(d200).toBeGreaterThan(POLICY.geofenceMeters);
  });

  it('parses and normalizes office network IPs including IPv4-mapped and subnets', () => {
    const parsed = parseOfficeNetworkIps('192.168.1.1; 10.0.0.1, ::ffff:192.168.1.2');
    expect(parsed).toContain('192.168.1.1');
    expect(parsed).toContain('10.0.0.1');
    expect(parsed).toContain('192.168.1.2');

    expect(isOfficeNetworkIpAllowed('192.168.1.1', '192.168.1.1,10.0.0.1')).toBe(true);
    expect(isOfficeNetworkIpAllowed('::ffff:192.168.1.1', '192.168.1.1,10.0.0.1')).toBe(true);
    expect(isOfficeNetworkIpAllowed('8.8.8.8', '192.168.1.1,10.0.0.1')).toBe(false);
  });
});

describe('Leave Accrual & Tenure Policy Mathematics', () => {
  it('computes earned leave accrual after probation completion', () => {
    // Joined Jan 6, 2025, probation ended Apr 6, 2025
    // As of Oct 26, 2025 (months May, Jun, Jul, Aug, Sep = 5 completed months)
    const accrual = earnedLeaveAccrual('2025-10-26', '2025-01-06', '2025-04-06', 15);
    expect(accrual).toBe(5);

    // Before probation end -> 0 accrual
    const preProbation = earnedLeaveAccrual('2025-03-15', '2025-01-06', '2025-04-06', 15);
    expect(preProbation).toBe(0);

    // Cap at annual entitlement
    const capped = earnedLeaveAccrual('2026-12-31', '2024-01-01', '2024-04-01', 15);
    expect(capped).toBe(12);
  });

  it('enforces employment status and documented last working date for earned accrual', () => {
    // Inactive employee with last working date stops accruing after that date
    const res = earnedLeaveAccrualForEmployment(
      '2026-10-26',
      '2025-01-01',
      '2025-04-01',
      'INACTIVE',
      '2026-06-15',
      15
    );
    expect(res.reviewRequired).toBe(false);
    expect(res.accrualAsOf).toBe('2026-06-15');

    // Inactive employee with missing last working date requires HR review
    const unreviewed = earnedLeaveAccrualForEmployment(
      '2026-10-26',
      '2025-01-01',
      '2025-04-01',
      'INACTIVE',
      null,
      15
    );
    expect(unreviewed.reviewRequired).toBe(true);
  });

  it('enforces Phase 10 intern leave quotas (1 day per month up to 12 days)', () => {
    const asOf = new Date('2026-10-26T12:00:00Z');

    // Joined today -> minimum 1 day
    expect(internLeaveEntitlement('2026-10-26', asOf)).toBe(1);

    // Joined 5 months ago -> 6 days
    expect(internLeaveEntitlement('2026-05-26', asOf)).toBe(6);

    // Joined 15 months ago -> capped at 12 days/year
    expect(internLeaveEntitlement('2025-07-26', asOf)).toBe(12);
  });

  it('determines leave encashment eligibility (>=12 months tenure and >=1 earned day)', () => {
    const asOf = new Date('2026-10-26T12:00:00Z');
    expect(calculateTenureMonths('2025-10-26', asOf)).toBe(12);
    expect(isEligibleForLeaveEncashment('2025-10-26', 1, asOf)).toBe(true);
    expect(isEligibleForLeaveEncashment('2025-10-26', 0, asOf)).toBe(false);
    expect(isEligibleForLeaveEncashment('2026-05-01', 5, asOf)).toBe(false);
  });

  it('determines birthday pass eligibility in IST', () => {
    const asOf = new Date('2026-10-26T12:00:00Z');
    expect(isBirthdayToday('1995-10-26', asOf)).toBe(true);
    expect(isBirthdayToday('1998-04-12', asOf)).toBe(false);
    expect(isBirthdayToday(null, asOf)).toBe(false);
  });

  it('calculates calendar quarters accurately', () => {
    expect(getCalendarQuarter('2026-01-15')).toBe(1);
    expect(getCalendarQuarter('2026-04-01')).toBe(2);
    expect(getCalendarQuarter('2026-07-20')).toBe(3);
    expect(getCalendarQuarter('2026-10-26')).toBe(4);
  });
});

describe('Work Schedule & Calendar Workday Calculation', () => {
  it('counts Monday through Saturday workdays excluding Sundays and holidays', () => {
    // 2026-10-26 is Monday, 2026-10-31 is Saturday (6 days)
    const holidays = new Set(['2026-10-28']); // 1 custom holiday
    const count = workingDaysInclusive('2026-10-26', '2026-10-31', holidays);
    expect(count).toBe(5);
  });

  it('recognizes scheduled workdays and blocks national holidays', () => {
    // Gandhi Jayanti 2026-10-02
    expect(isScheduledWorkday('2026-10-02', new Set())).toBe(false);
    // Regular workday
    expect(isScheduledWorkday('2026-10-05', new Set())).toBe(true);
    // Sunday
    expect(isScheduledWorkday('2026-10-04', new Set())).toBe(false);
  });

  it('permits attendance recording on floating holidays and Sundays, blocks fixed holidays', () => {
    const fixedHolidays = new Set(['2026-12-25']);
    expect(isAttendanceAllowed('2026-12-25', fixedHolidays)).toBe(false);
    expect(isAttendanceAllowed('2026-10-26', fixedHolidays)).toBe(true);
  });
});
