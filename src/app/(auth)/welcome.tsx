import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Display, Robin, Screen, Stack, Voice } from '@/ui/components';
import { signInWithGoogle } from '@/lib/oauth';
import { friendlyError } from '@/lib/errors';
import { getPendingInvite } from '@/lib/pendingInvite';
import { space } from '@/ui/theme';

export default function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = getPendingInvite();

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(friendlyError(e, 'Google sign-in didn’t work. Try email instead.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ alignItems: 'center', marginTop: space.xxl, gap: space.lg }}>
        <Robin pose="singing" size={160} />
        <Display style={{ textAlign: 'center' }}>Robin</Display>
        <Voice style={{ textAlign: 'center', fontSize: 20, lineHeight: 28 }}>
          No matter what parenthood throws at you, we&apos;ve got you.
        </Voice>
      </View>
      <Stack gap={space.md} style={{ marginTop: space.xxl }}>
        {pending ? <Banner text="You've been invited to a family. Sign in or create an account to join." /> : null}
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Create an account" onPress={() => router.push('/sign-up')} />
        <Button label="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
        <Button label="Continue with Google" variant="secondary" loading={busy} onPress={google} />
      </Stack>
    </Screen>
  );
}
