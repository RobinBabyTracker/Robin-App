import { useState } from 'react';
import { router } from 'expo-router';
import { Banner, Button, Screen, Stack, TextField, Voice } from '@/ui/components';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { validateEmail } from '@/lib/forms';
import { space } from '@/ui/theme';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (validateEmail(email)) return;
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (e) throw e;
      router.push({ pathname: '/verify', params: { mode: 'recovery', email: email.trim() } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.lg}>
        <Voice>Enter your email and we'll send a code to set a new password.</Voice>
        {error ? <Banner tone="error" text={error} /> : null}
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={touched ? validateEmail(email) : null} />
        <Button label="Send code" loading={busy} onPress={submit} />
      </Stack>
    </Screen>
  );
}
