// Time zone helpers. Everything is stored as UTC instants (ISO strings);
// people see times in their own profile time zone. All-day items are shown on
// the calendar dates of the time zone they were created in, so a birthday
// doesn't drift a day for a relative overseas.
// Pure module (no React Native imports) so it can be unit tested with Node.

export type LocalDate = { year: number; month: number; day: number }; // month 1-12
export type LocalDateTime = LocalDate & { hour: number; minute: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wall-clock parts of an instant in a time zone. weekday: 0 = Sunday. */
export function zonedParts(instant: Date | string, tz: string) {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second),
    weekday: WEEKDAYS.indexOf(out.weekday),
  };
}

/** Offset (ms) of a time zone from UTC at a given instant. */
export function tzOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

/** The UTC instant for a wall-clock time in a time zone (DST-safe). */
export function zonedToUtc(local: LocalDateTime, tz: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let utc = guess - tzOffsetMs(new Date(guess), tz);
  const second = guess - tzOffsetMs(new Date(utc), tz);
  if (second !== utc) utc = second;
  return new Date(utc);
}

export function dateKey(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function parseDateKey(key: string): LocalDate {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function weekdayOf(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return dateKey(a) < dateKey(b) ? -1 : dateKey(a) > dateKey(b) ? 1 : 0;
}

export function todayIn(tz: string, now = new Date()): LocalDate {
  const p = zonedParts(now, tz);
  return { year: p.year, month: p.month, day: p.day };
}

/** Sunday-start week containing d. */
export function startOfWeek(d: LocalDate): LocalDate {
  return addDays(d, -weekdayOf(d));
}

/** 6 x 7 grid of dates for a month view (Sunday start). */
export function monthGrid(year: number, month: number): LocalDate[] {
  const first = { year, month, day: 1 };
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function addMonths(year: number, month: number, n: number) {
  const idx = year * 12 + (month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** UTC range covering whole local days [from, toInclusive] in tz. */
export function dayRangeUtc(from: LocalDate, toInclusive: LocalDate, tz: string) {
  const start = zonedToUtc({ ...from, hour: 0, minute: 0 }, tz);
  const end = zonedToUtc({ ...addDays(toInclusive, 1), hour: 0, minute: 0 }, tz);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** For all-day items: the stored range for local dates [startDate, endDate] in tz. */
export function allDayRange(startDate: LocalDate, endDate: LocalDate, tz: string) {
  const start = zonedToUtc({ ...startDate, hour: 0, minute: 0 }, tz);
  const end = new Date(zonedToUtc({ ...addDays(endDate, 1), hour: 0, minute: 0 }, tz).getTime() - 60_000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

type CalendarLike = { starts_at: string; ends_at: string; all_day: boolean; timezone: string };

/** Local dates (in viewer tz, or event tz when all-day) an item covers. */
export function itemDateKeys(item: CalendarLike, viewerTz: string): string[] {
  const tz = item.all_day ? item.timezone : viewerTz;
  const s = zonedParts(item.starts_at, tz);
  const e = zonedParts(item.ends_at, tz);
  let d: LocalDate = { year: s.year, month: s.month, day: s.day };
  const end: LocalDate = { year: e.year, month: e.month, day: e.day };
  const keys: string[] = [];
  for (let i = 0; i < 62 && compareDates(d, end) <= 0; i++) {
    keys.push(dateKey(d));
    d = addDays(d, 1);
  }
  return keys;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const monthName = (m: number, long = true) => (long ? MONTHS_LONG : MONTHS)[m - 1];
export const weekdayName = (w: number, long = false) => (long ? DAYS_LONG : WEEKDAYS)[w];

export function formatTime(iso: string, tz: string): string {
  const p = zonedParts(iso, tz);
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? 'am' : 'pm';
  return p.minute === 0 ? `${h}${ampm}` : `${h}:${String(p.minute).padStart(2, '0')}${ampm}`;
}

export function formatDate(d: LocalDate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const wd = opts.weekday ? `${weekdayName(weekdayOf(d))} ` : '';
  return `${wd}${d.day} ${monthName(d.month, false)}${opts.year ? ` ${d.year}` : ''}`;
}

export function relativeDayLabel(d: LocalDate, tz: string, now = new Date()): string {
  const today = todayIn(tz, now);
  if (compareDates(d, today) === 0) return 'Today';
  if (compareDates(d, addDays(today, 1)) === 0) return 'Tomorrow';
  if (compareDates(d, addDays(today, -1)) === 0) return 'Yesterday';
  return `${weekdayName(weekdayOf(d), true)} ${d.day} ${monthName(d.month, false)}`;
}

/** "Fri 16 Oct, 11am – 2pm", "Sat 17 Oct, all day", "Fri 16 – Sun 18 Oct, all day" */
export function formatWhen(item: CalendarLike, viewerTz: string): string {
  if (item.all_day) {
    const s = zonedParts(item.starts_at, item.timezone);
    const e = zonedParts(item.ends_at, item.timezone);
    const sd = { year: s.year, month: s.month, day: s.day };
    const ed = { year: e.year, month: e.month, day: e.day };
    if (compareDates(sd, ed) === 0) return `${formatDate(sd, { weekday: true })}, all day`;
    return `${formatDate(sd, { weekday: true })} – ${formatDate(ed, { weekday: true })}, all day`;
  }
  const s = zonedParts(item.starts_at, viewerTz);
  const e = zonedParts(item.ends_at, viewerTz);
  const sd = { year: s.year, month: s.month, day: s.day };
  const ed = { year: e.year, month: e.month, day: e.day };
  const sameDay = compareDates(sd, ed) === 0;
  const start = `${formatDate(sd, { weekday: true })}, ${formatTime(item.starts_at, viewerTz)}`;
  if (item.starts_at === item.ends_at) return start;
  return sameDay
    ? `${start} – ${formatTime(item.ends_at, viewerTz)}`
    : `${start} – ${formatDate(ed, { weekday: true })}, ${formatTime(item.ends_at, viewerTz)}`;
}

/** If the event was planned in another time zone, a hint like "4pm in Sydney". */
export function otherZoneHint(item: CalendarLike, viewerTz: string): string | null {
  if (item.all_day || item.timezone === viewerTz) return null;
  if (tzOffsetMs(new Date(item.starts_at), item.timezone) === tzOffsetMs(new Date(item.starts_at), viewerTz)) return null;
  const city = item.timezone.split('/').pop()?.replace(/_/g, ' ') ?? item.timezone;
  return `${formatTime(item.starts_at, item.timezone)} in ${city}`;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Brisbane';
  } catch {
    return 'Australia/Brisbane';
  }
}

export function timeAgo(iso: string, tz: string, now = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const d = zonedParts(iso, tz);
  const ld = { year: d.year, month: d.month, day: d.day };
  const today = todayIn(tz, now);
  if (compareDates(ld, today) === 0) return formatTime(iso, tz);
  if (compareDates(ld, addDays(today, -1)) === 0) return 'Yesterday';
  if (diff < 6 * 86400) return weekdayName(d.weekday);
  return formatDate(ld);
}
