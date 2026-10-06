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
export function attendanceStatus(checkIn, approvedStart, lateThreshold = POLICY.lateThreshold) {
  const local = indiaParts(checkIn);
  const threshold = minutesOfTime(approvedStart || lateThreshold);
  const checkedAt = Number(local.hour) * 60 + Number(local.minute) + Number(local.second) / 60;
  return (approvedStart ? checkedAt <= threshold : checkedAt < threshold) ? 'ON_TIME' : 'LATE_ENTRY';
}
export function expectedShiftStart(approvedStart) {
  return approvedStart || POLICY.standardStart;
}
