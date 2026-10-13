import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function env(name: string, ...fallbacks: string[]): string {
  for (const n of [name, ...fallbacks]) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  throw new Error(`Missing environment variable ${name}`);
}

/** Service-role client. Server-side only: never ship this key in the app. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Constant-time comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function requireSecret(req: Request, name = 'ROBIN_FUNCTION_SECRET'): Response | null {
  const expected = Deno.env.get(name);
  const given = req.headers.get('x-robin-secret') ?? '';
  if (!expected || !safeEqual(given, expected)) return json({ error: 'unauthorised' }, 401);
  return null;
}
