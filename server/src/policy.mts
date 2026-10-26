import net from 'node:net';

export const TIME_ZONE = 'Asia/Kolkata';
export const POLICY = Object.freeze({
  officeName: 'Falchion Xeniaa Pune HQ',
  latitude: 18.506633,
  longitude: 73.857692,
  geofenceMeters: 80,
  standardStart: '09:00',
  standardEnd: '18:00',
  lateThreshold: '09:30',
  fixedLunchMinutes: 30,
  weeklyWorkDays: [1, 2, 3, 4, 5, 6],
  leaveEntitlements: { CASUAL: 8, SICK: 8, EARNED: 15, FLOATING: 4 },
  earnedLeaveMonthlyAccrual: 1,
  wfhTypicalMonthlyCap: 4,
  gpsMaxAccuracyMeters: 100
});

export function indiaParts(date: Date | string = new Date()) {
  const instant = typeof date === 'string'
    ? new Date(`${date.replace(' ', 'T').replace(/Z$/, '')}Z`)
    : date;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}
export const indiaDate = (date = new Date()) => {
  const p = indiaParts(date);
  return `${p.year}-${p.month}-${p.day}`;
};
export const indiaTime = (date = new Date()) => {
  const p = indiaParts(date);
  return `${p.hour}:${p.minute}:${p.second}`;
};
export function nationalHolidayDates(year) {
  return [[1,26],[8,15],[10,2]].map(([month,day]) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
}
export function isScheduledWorkday(date, companyHolidayDates = new Set()) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && !companyHolidayDates.has(date) && !nationalHolidayDates(Number(date.slice(0,4))).includes(date);
}

// Attendance can be recorded on any calendar day. The only blocked dates are
// fixed company holidays and the fixed national holidays defined by policy.
// Floating holidays are intentionally absent from the fixedHolidayDates set.
export function isAttendanceAllowed(date, fixedHolidayDates = new Set()) {
  return !fixedHolidayDates.has(date) && !nationalHolidayDates(Number(date.slice(0,4))).includes(date);
}
export function normalizeClientIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
export function parseOfficeNetworkIps(value) {
  return [...new Set(String(value || '').split(/[;,]/).map(normalizeClientIp).filter((ip) => net.isIP(ip)))];
}
export function isOfficeNetworkIpAllowed(clientIp, configuredIps) {
  const candidate = normalizeClientIp(clientIp);
  return parseOfficeNetworkIps(configuredIps).includes(candidate);
}
export function minutesOfTime(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earth = 6371000;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function workingDaysInclusive(from, to, holidays = new Set()) {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  let days = 0;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && !holidays.has(key)) days += 1;
  }
  return days;
}
export function elapsedMinutes(start, end) {
  const parse = (value) => value instanceof Date ? value.getTime() : new Date(value instanceof String || typeof value === 'string' ? `${String(value).replace(' ', 'T').replace(/Z$/, '')}Z` : value).getTime();
  const minutes = (parse(end) - parse(start)) / 60000;
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
}
export function netWorkedMinutes(start: any, end: any, fixedLunchMinutes: number = POLICY.fixedLunchMinutes) {
  return Math.max(0, elapsedMinutes(start, end) - fixedLunchMinutes);
}
export function attendanceStatus(checkIn, approvedStart, lateThreshold: string = POLICY.lateThreshold) {
  const local = indiaParts(checkIn);
  const threshold = minutesOfTime(approvedStart || lateThreshold);
  const checkedAt = Number(local.hour) * 60 + Number(local.minute) + Number(local.second) / 60;
  return (approvedStart ? checkedAt <= threshold : checkedAt < threshold) ? 'ON_TIME' : 'LATE_ENTRY';
}
export function expectedShiftStart(approvedStart) {
  return approvedStart || POLICY.standardStart;
}

export function hasPassedAbsenceCutoff(currentTime: string, scheduledStart: string | null | undefined, graceMinutes = 90) {
  const [hour, minute, second = 0] = String(currentTime).split(':').map(Number);
  if (![hour, minute, second].every(Number.isFinite)) return false;
  const grace = Number.isFinite(graceMinutes) ? Math.max(0, Math.round(graceMinutes)) : 90;
  const cutoffMinutes = minutesOfTime(scheduledStart || POLICY.standardStart) + grace;
  return hour * 60 + minute + second / 60 > cutoffMinutes;
}

export function earnedLeaveAccrualForEmployment(
  asOfDate: string,
  joinedOn: string | null | undefined,
  probationEndDate: string | null | undefined,
  employmentStatus: string | null | undefined,
  lastWorkingDate: string | null | undefined,
  entitlement = POLICY.leaveEntitlements.EARNED
) {
  const status = String(employmentStatus || 'ACTIVE').toUpperCase();
  const validLastWorkingDate = /^\d{4}-\d{2}-\d{2}$/.test(String(lastWorkingDate || '').slice(0,10))
    ? String(lastWorkingDate).slice(0,10) : '';
  if (status !== 'INACTIVE') {
    return {
      accrued: earnedLeaveAccrual(asOfDate, joinedOn, probationEndDate, entitlement),
      reviewRequired: false,
      accrualAsOf: asOfDate
    };
  }
  if (!validLastWorkingDate) {
    return {
      accrued: earnedLeaveAccrual(asOfDate, joinedOn, probationEndDate, entitlement),
      reviewRequired: true,
      accrualAsOf: null
    };
  }
  const accrualAsOf = validLastWorkingDate < asOfDate ? validLastWorkingDate : asOfDate;
  return {
    accrued: earnedLeaveAccrual(accrualAsOf, joinedOn, probationEndDate, entitlement),
    reviewRequired: false,
    accrualAsOf
  };
}

export function earnedLeaveAccrual(asOfDate: string, joinedOn: string | null | undefined, probationEndDate: string | null | undefined, entitlement = POLICY.leaveEntitlements.EARNED) {
  const accrualStart = String(probationEndDate || joinedOn || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !/^\d{4}-\d{2}-\d{2}$/.test(accrualStart) || accrualStart > asOfDate) return 0;
  const year = Number(asOfDate.slice(0,4));
  const month = Number(asOfDate.slice(5,7));
  const day = Number(asOfDate.slice(8,10));
  const startYear = Number(accrualStart.slice(0,4));
  const startMonth = Number(accrualStart.slice(5,7));
  const firstEligibleMonth = startYear < year ? 1 : startYear > year ? 13 : startMonth + 1;
  const lastAccrualMonth = day === new Date(year,month,0).getDate() ? month : month - 1;
  const cap = Number.isFinite(entitlement) ? Math.max(0,entitlement) : POLICY.leaveEntitlements.EARNED;
  return Math.max(0,Math.min(cap,lastAccrualMonth-firstEligibleMonth+1));
}

export function isBirthdayToday(dateOfBirth: string | Date | null | undefined, asOf: Date | string = new Date()): boolean {
  if (!dateOfBirth) return false;
  const dobStr = typeof dateOfBirth === 'string' ? dateOfBirth.slice(0, 10) : dateOfBirth.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobStr)) return false;
  const p = indiaParts(asOf);
  const dobMonthDay = dobStr.slice(5, 10);
  const todayMonthDay = `${p.month}-${p.day}`;
  return dobMonthDay === todayMonthDay;
}

export function calculateTenureMonths(joinedOn: string | Date | null | undefined, asOf: Date | string = new Date()): number {
  if (!joinedOn) return 0;
  const joinStr = typeof joinedOn === 'string' ? joinedOn.slice(0, 10) : joinedOn.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinStr)) return 0;
  const p = indiaParts(asOf);
  const joinYear = Number(joinStr.slice(0, 4));
  const joinMonth = Number(joinStr.slice(5, 7));
  const joinDay = Number(joinStr.slice(8, 10));
  const currentYear = Number(p.year);
  const currentMonth = Number(p.month);
  const currentDay = Number(p.day);

  let months = (currentYear - joinYear) * 12 + (currentMonth - joinMonth);
  if (currentDay < joinDay) {
    months -= 1;
  }
  return Math.max(0, months);
}

export function isEligibleForLeaveEncashment(joinedOn: string | Date | null | undefined, earnedBalance: number, asOf: Date | string = new Date()): boolean {
  return calculateTenureMonths(joinedOn, asOf) >= 12 && Number(earnedBalance) >= 1;
}

export function internLeaveEntitlement(joinedOn: string | Date | null | undefined, asOf: Date | string = new Date()): number {
  if (!joinedOn) return 1;
  const tenureMonths = calculateTenureMonths(joinedOn, asOf);
  // Interns accrue leave at 1 day per month worked, min 1 day upon joining, capped at 12 days per year.
  return Math.max(1, Math.min(12, tenureMonths + 1));
}

export function getCalendarQuarter(dateStr: string): number {
  const month = Number(dateStr.slice(5, 7));
  return Math.floor((month - 1) / 3) + 1;
}
