import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedToUtc, zonedParts, allDayRange, itemDateKeys, formatWhen, formatTime, monthGrid, startOfWeek,
  dayRangeUtc, otherZoneHint, addMonths, relativeDayLabel,
} from './time.ts';
import { validateTask, extractInviteToken, formatInviteCode, checkMedia, guessMime, validateEmail, type TaskDraft } from './forms.ts';
import { friendlyError, errorCode } from './errors.ts';

test('zonedToUtc: Brisbane has no daylight saving', () => {
  assert.equal(zonedToUtc({ year: 2026, month: 10, day: 14, hour: 14, minute: 0 }, 'Australia/Brisbane').toISOString(), '2026-10-14T04:00:00.000Z');
  assert.equal(zonedToUtc({ year: 2026, month: 1, day: 14, hour: 14, minute: 0 }, 'Australia/Brisbane').toISOString(), '2026-01-14T04:00:00.000Z');
});

test('zonedToUtc: Sydney and London across daylight saving', () => {
  // Sydney: AEST (+10) in July, AEDT (+11) in December.
  assert.equal(zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, 'Australia/Sydney').toISOString(), '2026-06-30T23:30:00.000Z');
  assert.equal(zonedToUtc({ year: 2026, month: 12, day: 1, hour: 9, minute: 30 }, 'Australia/Sydney').toISOString(), '2026-11-30T22:30:00.000Z');
  // London: GMT in January, BST in July.
  assert.equal(zonedToUtc({ year: 2026, month: 1, day: 10, hour: 12, minute: 0 }, 'Europe/London').toISOString(), '2026-01-10T12:00:00.000Z');
  assert.equal(zonedToUtc({ year: 2026, month: 7, day: 10, hour: 12, minute: 0 }, 'Europe/London').toISOString(), '2026-07-10T11:00:00.000Z');
  // Day of the change (Sydney DST starts 4 Oct 2026 at 2am → 3am).
  assert.equal(zonedToUtc({ year: 2026, month: 10, day: 4, hour: 12, minute: 0 }, 'Australia/Sydney').toISOString(), '2026-10-04T01:00:00.000Z');
});

test('round trip: wall time -> UTC -> wall time', () => {
  for (const tz of ['Australia/Brisbane', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'Asia/Kolkata']) {
    for (const month of [1, 4, 7, 10]) {
      const utc = zonedToUtc({ year: 2026, month, day: 15, hour: 8, minute: 45 }, tz);
      const p = zonedParts(utc, tz);
      assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, month, 15, 8, 45], `${tz} ${month}`);
    }
  }
});

test('all-day items stay on their dates for viewers in other time zones', () => {
  const r = allDayRange({ year: 2026, month: 10, day: 26 }, { year: 2026, month: 10, day: 26 }, 'Australia/Brisbane');
  const item = { ...r, all_day: true, timezone: 'Australia/Brisbane' };
  assert.deepEqual(itemDateKeys(item, 'Europe/London'), ['2026-10-26']);
  assert.deepEqual(itemDateKeys(item, 'Australia/Brisbane'), ['2026-10-26']);
  assert.equal(formatWhen(item, 'Europe/London'), 'Mon 26 Oct, all day');
});

test('timed items show in the viewer’s own time', () => {
  const item = { starts_at: '2026-10-14T04:00:00.000Z', ends_at: '2026-10-14T07:00:00.000Z', all_day: false, timezone: 'Australia/Brisbane' };
  assert.equal(formatWhen(item, 'Australia/Brisbane'), 'Wed 14 Oct, 2pm – 5pm');
  assert.equal(formatWhen(item, 'Europe/London'), 'Wed 14 Oct, 5am – 8am');
  assert.equal(otherZoneHint(item, 'Europe/London'), '2pm in Brisbane');
  assert.equal(otherZoneHint(item, 'Australia/Brisbane'), null);
  assert.equal(formatTime('2026-10-14T03:30:00.000Z', 'Australia/Brisbane'), '1:30pm');
  assert.deepEqual(itemDateKeys(item, 'Australia/Brisbane'), ['2026-10-14']);
});

test('an overnight item spans two days', () => {
  const item = { starts_at: '2026-10-14T10:00:00.000Z', ends_at: '2026-10-14T22:00:00.000Z', all_day: false, timezone: 'Australia/Brisbane' };
  assert.deepEqual(itemDateKeys(item, 'Australia/Brisbane'), ['2026-10-14', '2026-10-15']);
});

test('month grid and weeks start on Sunday', () => {
  const g = monthGrid(2026, 10);
  assert.equal(g.length, 42);
  assert.deepEqual(g[0], { year: 2026, month: 9, day: 27 });
  assert.deepEqual(startOfWeek({ year: 2026, month: 10, day: 14 }), { year: 2026, month: 10, day: 11 });
  assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
  const r = dayRangeUtc({ year: 2026, month: 10, day: 11 }, { year: 2026, month: 10, day: 17 }, 'Australia/Brisbane');
  assert.equal(r.from, '2026-10-10T14:00:00.000Z');
  assert.equal(r.to, '2026-10-17T14:00:00.000Z');
});

test('relative day labels', () => {
  const now = new Date('2026-10-13T02:00:00Z'); // Tue 13 Oct, noon in Brisbane
  assert.equal(relativeDayLabel({ year: 2026, month: 10, day: 13 }, 'Australia/Brisbane', now), 'Today');
  assert.equal(relativeDayLabel({ year: 2026, month: 10, day: 14 }, 'Australia/Brisbane', now), 'Tomorrow');
  assert.equal(relativeDayLabel({ year: 2026, month: 10, day: 16 }, 'Australia/Brisbane', now), 'Friday 16 Oct');
});

const draft = (o: Partial<TaskDraft> = {}): TaskDraft => ({
  kind: 'help', category: 'childcare', title: 'School pick-up', description: '', location: '', notes: '', links: [],
  allDay: false, startsAt: new Date('2026-10-20T05:00:00Z'), endsAt: new Date('2026-10-20T06:00:00Z'),
  respondBy: null, helpersNeeded: 1, invitees: null, ...o,
});
const NOW = new Date('2026-10-13T00:00:00Z');

test('task validation', () => {
  assert.deepEqual(validateTask(draft(), NOW), {});
  assert.ok(validateTask(draft({ title: '  ' }), NOW).title);
  assert.ok(validateTask(draft({ endsAt: new Date('2026-10-20T04:00:00Z') }), NOW).time);
  assert.ok(validateTask(draft({ respondBy: new Date('2026-10-21T00:00:00Z') }), NOW).respondBy);
  assert.ok(validateTask(draft({ startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-01T01:00:00Z') }), NOW).time);
  assert.deepEqual(validateTask(draft({ startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-01T01:00:00Z') }), NOW, { sending: false }), {});
  assert.ok(validateTask(draft({ links: ['not a link'] }), NOW).links);
  assert.ok(validateTask(draft({ invitees: [] }), NOW).invitees);
  assert.ok(validateTask(draft({ helpersNeeded: 0 }), NOW).helpersNeeded);
});

test('invite links and tokens', () => {
  const tok = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-';
  assert.equal(extractInviteToken(`robin://invite/${tok}`), tok);
  assert.equal(extractInviteToken(`https://robin.app/invite/${tok}?x=1`), tok);
  assert.equal(extractInviteToken(`  ${tok}  `), tok);
  assert.equal(extractInviteToken('hello'), null);
  assert.equal(extractInviteToken(''), null);
});

test('short invite codes', () => {
  assert.equal(extractInviteToken('K7PQ-2MXR'), 'K7PQ2MXR');
  assert.equal(extractInviteToken(' k7pq 2mxr '), 'K7PQ2MXR');
  assert.equal(extractInviteToken('robin://invite/K7PQ2MXR'), 'K7PQ2MXR');
  assert.equal(extractInviteToken('exp://silver-pancake-8081.app.github.dev/--/invite/K7PQ2MXR'), 'K7PQ2MXR');
  assert.equal(extractInviteToken('Join The Parkers on Robin! Open Robin, tap “I have an invite code” and enter K7PQ-2MXR. It works once.'), 'K7PQ2MXR');
  assert.equal(extractInviteToken('K7PQ-2MX'), null);
  assert.equal(formatInviteCode('K7PQ2MXR'), 'K7PQ-2MXR');
});

test('media checks', () => {
  assert.equal(checkMedia('photo', 'image/jpeg', 1000), null);
  assert.ok(checkMedia('photo', 'image/gif', 1000));
  assert.ok(checkMedia('photo', 'image/jpeg', 21 * 1024 * 1024));
  assert.equal(checkMedia('video', 'video/mp4', 1000, 180_000), null);
  assert.ok(checkMedia('video', 'video/mp4', 1000, 181_000));
  assert.ok(checkMedia('video', 'video/mp4', 1000, null));
  assert.equal(guessMime('file:///x/IMG_1.HEIC', null, 'photo'), 'image/heic');
  assert.equal(guessMime('file:///x/a.mov', undefined, 'video'), 'video/quicktime');
});

test('email validation', () => {
  assert.equal(validateEmail('jess@example.com'), null);
  assert.ok(validateEmail('jess@'));
});

test('friendly errors', () => {
  assert.equal(errorCode({ message: 'invite_expired' }), 'invite_expired');
  assert.match(friendlyError({ message: 'invite_expired' }), /run out/);
  assert.match(friendlyError({ message: 'TypeError: Network request failed' }), /offline/);
  assert.match(friendlyError({ message: 'Invalid login credentials' }), /don’t match/);
  assert.equal(friendlyError({ message: 'weird' }), 'Something went wrong. Please try again.');
});

test('the welcome tour shows only for new accounts that have not seen it', async () => {
  const { guide } = await import('./guide.ts');
  const now = Date.parse('2026-10-18T00:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  assert.equal(guide.shouldShowTour({ id: 'a', created_at: new Date(now - day).toISOString() }, now), true);
  assert.equal(guide.shouldShowTour({ id: 'b', created_at: new Date(now - 10 * day).toISOString() }, now), false, 'existing accounts skip it');
  assert.equal(guide.shouldShowTour({ id: 'c', created_at: new Date(now - day).toISOString(), user_metadata: { tour_seen: true } }, now), false, 'seen on another phone');
  assert.equal(guide.shouldShowTour({ id: 'd' }, now), false, 'unknown age: do not interrupt');
});
