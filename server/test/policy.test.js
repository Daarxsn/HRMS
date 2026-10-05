import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceStatus, distanceMeters, isScheduledWorkday, netWorkedMinutes, workingDaysInclusive } from '../src/policy.js';

test('9:29:59 AM is on time; 9:30:00 AM is late in Pune time', () => {
  assert.equal(attendanceStatus(new Date('2026-10-02T03:59:59Z')), 'ON_TIME');
  assert.equal(attendanceStatus(new Date('2026-10-02T04:00:00Z')), 'LATE_ENTRY');
});

test('an approved 10:30 AM flex start is respected to the minute and second', () => {
  assert.equal(attendanceStatus(new Date('2026-10-02T05:00:00Z'), '10:30:00'), 'ON_TIME');
  assert.equal(attendanceStatus(new Date('2026-10-02T05:00:01Z'), '10:30:00'), 'LATE_ENTRY');
});

test('the Pune geofence measures metres from the configured office point', () => {
  const inside = distanceMeters(18.506633, 73.857692, 18.5070, 73.857692);
  const outside = distanceMeters(18.506633, 73.857692, 18.5077, 73.857692);
  assert.ok(inside < 80);
  assert.ok(outside > 80);
});

test('the work week counts Monday through Saturday and excludes Sunday and listed holidays', () => {
  assert.equal(workingDaysInclusive('2026-10-02', '2026-10-04'), 2);
  assert.equal(workingDaysInclusive('2026-10-02', '2026-10-04', new Set(['2026-10-02'])), 1);
});

test('Sunday, national holidays and company holidays are not scheduled attendance days', () => {
  assert.equal(isScheduledWorkday('2026-10-03'), true);
  assert.equal(isScheduledWorkday('2026-10-04'), false);
  assert.equal(isScheduledWorkday('2026-10-02'), false);
  assert.equal(isScheduledWorkday('2026-10-03',new Set(['2026-10-03'])), false);
});

test('work duration always deducts the fixed 30-minute lunch and never goes below zero', () => {
  assert.equal(netWorkedMinutes('2026-10-02 03:30:00', '2026-10-02 12:30:00'), 510);
  assert.equal(netWorkedMinutes('2026-10-02 03:30:00', '2026-10-02 11:30:00'), 450);
  assert.equal(netWorkedMinutes('2026-10-02 03:30:00', '2026-10-02 03:50:00'), 0);
});
