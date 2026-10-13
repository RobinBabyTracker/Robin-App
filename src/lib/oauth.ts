import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

/**
 * Google sign-in through Supabase (PKCE). Requires the Google provider to be
 * enabled in Supabase Auth and `robin://auth-callback` added to the allowed
 * redirect URLs. Returns false if the person closed the browser.
 */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return false;
  const { queryParams } = Linking.parse(res.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  const errDesc = typeof queryParams?.error_description === 'string' ? queryParams.error_description : null;
  if (errDesc) throw new Error(errDesc);
  if (!code) throw new Error('Google sign-in did not complete.');
  const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exErr) throw exErr;
  return true;
}
