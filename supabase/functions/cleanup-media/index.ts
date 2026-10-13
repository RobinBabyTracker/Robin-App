// Removes files that are no longer needed: media marked deleted (e.g. a parent
// removed someone else's memory) and uploads abandoned for more than a day.
// Run on a schedule (see README) with the header `x-robin-secret`.
import { json, requireSecret, serviceClient } from '../_shared/env.ts';

Deno.serve(async (req) => {
  const denied = requireSecret(req);
  if (denied) return denied;
  const admin = serviceClient();
  const { data, error } = await admin.rpc('admin_media_to_clean', { p_limit: 500 });
  if (error) return json({ error: 'lookup_failed' }, 500);
  const rows = (data ?? []) as { media_id: string; storage_path: string }[];
  const cleaned: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: rmErr } = await admin.storage.from('family-media').remove(batch.map((r) => r.storage_path));
    if (rmErr) { console.error('remove failed', rmErr.message); continue; }
    cleaned.push(...batch.map((r) => r.media_id));
  }
  let forgotten = 0;
  if (cleaned.length) {
    const { data: n, error: fErr } = await admin.rpc('admin_forget_media', { p_ids: cleaned });
    if (fErr) return json({ error: 'forget_failed' }, 500);
    forgotten = n as number;
  }
  return json({ files: cleaned.length, records: forgotten });
});
