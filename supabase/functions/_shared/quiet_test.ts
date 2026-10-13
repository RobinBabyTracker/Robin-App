import assert from 'node:assert/strict';
import { inQuietHours } from './quiet.ts';

Deno.test('quiet hours in the person’s own time zone, including overnight ranges', () => {
  const at = (iso: string) => new Date(iso);
  // 22:30 in Brisbane (UTC+10)
  assert.equal(inQuietHours(at('2026-10-13T12:30:00Z'), 'Australia/Brisbane', '21:00', '07:00'), true);
  // 06:59 in Brisbane
  assert.equal(inQuietHours(at('2026-10-12T20:59:00Z'), 'Australia/Brisbane', '21:00', '07:00'), true);
  // 07:00 in Brisbane: quiet hours over
  assert.equal(inQuietHours(at('2026-10-12T21:00:00Z'), 'Australia/Brisbane', '21:00', '07:00'), false);
  // Same instant is 13:30 in London: not quiet
  assert.equal(inQuietHours(at('2026-10-13T12:30:00Z'), 'Europe/London', '21:00', '07:00'), false);
  // Daytime range
  assert.equal(inQuietHours(at('2026-10-13T03:00:00Z'), 'Australia/Brisbane', '12:00', '14:00'), true);
  assert.equal(inQuietHours(at('2026-10-13T03:00:00Z'), 'Australia/Brisbane', null, null), false);
});
