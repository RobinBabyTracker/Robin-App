import { useState } from 'react';
import { router } from 'expo-router';
import { Banner, Button, Caption, Screen, Stack, TextField } from '@/ui/components';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { validateDisplayName, validateEmail, validatePassword } from '@/lib/forms';
import { space } from '@/ui/theme';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errs = { name: validateDisplayName(name), email: validateEmail(email), password: validatePassword(password) };
  const show = (k: keyof typeof errs) => (touched ? errs[k] : null);

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (errs.name || errs.email || errs.password) return;
    setBusy(true);
    try {
      const { data, error: e } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: name.trim() } },
      });
      if (e) throw e;
      // With email confirmation on, there's no session until the code is entered.
      if (!data.session) router.push({ pathname: '/verify', params: { mode: 'signup', email: email.trim() } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.lg}>
        {error ? <Banner tone="error" text={error} /> : null}
        <TextField label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" error={show('name')} hint="This is how your family will see you." />
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" error={show('email')} />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={show('password')} hint="At least 8 characters." />
        <Button label="Create account" loading={busy} onPress={submit} />
        <Caption>We only ask for what Robin needs. We never ask for details about your children.</Caption>
      </Stack>
    </Screen>
  );
}
