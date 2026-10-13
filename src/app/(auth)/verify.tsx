import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Banner, Button, Screen, Stack, TextField, Voice } from '@/ui/components';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { validatePassword } from '@/lib/forms';
import { space } from '@/ui/theme';

type Mode = 'signup' | 'email' | 'recovery';

export default function Verify() {
  const params = useLocalSearchParams<{ mode: Mode; email: string }>();
  const mode: Mode = params.mode === 'recovery' || params.mode === 'signup' ? params.mode : 'email';
  const email = params.email ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^\d{6,8}$/.test(code.trim())) { setError('Enter the code from your email.'); return; }
    if (mode === 'recovery') {
      const pwErr = validatePassword(password);
      if (pwErr) { setError(pwErr); return; }
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: mode });
      if (e) throw e;
      if (mode === 'recovery') {
        const { error: pe } = await supabase.auth.updateUser({ password });
        if (pe) throw pe;
      }
      // Signed in: the root navigator moves on automatically.
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const { error: e } =
        mode === 'signup'
          ? await supabase.auth.resend({ type: 'signup', email })
          : mode === 'recovery'
            ? await supabase.auth.resetPasswordForEmail(email)
            : await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (e) throw e;
      setNotice('A new code is on its way.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.lg}>
        <Voice>We've sent a code to {email}. It can take a minute to arrive.</Voice>
        {error ? <Banner tone="error" text={error} /> : null}
        {notice ? <Banner tone="success" text={notice} /> : null}
        <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} />
        {mode === 'recovery' ? (
          <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint="At least 8 characters." />
        ) : null}
        <Button label={mode === 'recovery' ? 'Save new password' : 'Continue'} loading={busy} onPress={submit} />
        <Button label="Send a new code" variant="text" loading={resending} onPress={resend} />
      </Stack>
    </Screen>
  );
}
