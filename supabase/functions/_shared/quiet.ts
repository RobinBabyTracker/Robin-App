// Is it currently within someone's quiet hours, in their own time zone?
export function inQuietHours(now: Date, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const n = toMin(hm), s = toMin(start), e = toMin(end);
  return s <= e ? n >= s && n < e : n >= s || n < e; // handles overnight ranges like 21:00–07:00
}
