import { useState } from 'react';
import { router } from 'expo-router';
import { Banner, Button, Screen, Segmented, Stack, TextField, Voice } from '@/ui/components';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { validateEmail } from '@/lib/forms';
import { space } from '@/ui/theme';

export default function SignIn() {
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailErr = touched ? validateEmail(email) : null;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (validateEmail(email)) return;
    if (mode === 'password' && !password) { setError('Enter your password.'); return; }
    setBusy(true);
    try {
      if (mode === 'password') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      } else {
        const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
        if (e) throw e;
        router.push({ pathname: '/verify', params: { mode: 'email', email: email.trim() } });
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.lg}>
        <Segmented
          label="How would you like to sign in?"
          value={mode}
          onChange={(m) => { setMode(m); setError(null); }}
          options={[{ value: 'password', label: 'Password' }, { value: 'code', label: 'Email me a code' }]}
        />
        {mode === 'code' ? <Voice>No password needed. We'll email you a 6-digit code.</Voice> : null}
        {error ? <Banner tone="error" text={error} /> : null}
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" error={emailErr} />
        {mode === 'password' ? (
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
        ) : null}
        <Button label={mode === 'password' ? 'Sign in' : 'Send my code'} loading={busy} onPress={submit} />
        {mode === 'password' ? <Button label="Forgotten your password?" variant="text" onPress={() => router.push('/forgot')} /> : null}
      </Stack>
    </Screen>
  );
}
