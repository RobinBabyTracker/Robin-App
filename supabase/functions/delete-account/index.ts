// Deletes the signed-in person's account.
// 1. Confirms who is asking from their own access token.
// 2. Hands over families they own, cancels their upcoming requests, detaches
//    them everywhere, and lists the files they uploaded (database function).
// 3. Removes those files from storage.
// 4. Deletes the auth user, which cascades to their profile and rows.
// Safe to retry: each step can run again without harm.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env, json, serviceClient } from '../_shared/env.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorised' }, 401);

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (body.confirm !== 'DELETE') return json({ error: 'confirmation_required' }, 400);

  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await asUser.auth.getUser(authHeader.slice(7));
  if (whoErr || !who.user) return json({ error: 'unauthorised' }, 401);
  const userId = who.user.id;

  const admin = serviceClient();
  const { data: paths, error: prepErr } = await admin.rpc('admin_prepare_account_deletion', { p_user: userId });
  if (prepErr) return json({ error: 'prepare_failed' }, 500);

  const files = (paths ?? []) as string[];
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await admin.storage.from('family-media').remove(files.slice(i, i + 100));
    // Not fatal: the records are already marked deleted and unreadable, and the
    // cleanup-media schedule will retry the files.
    if (error) console.error('storage remove failed', error.message);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: 'delete_failed' }, 500);
  return json({ deleted: true, files: files.length });
});
