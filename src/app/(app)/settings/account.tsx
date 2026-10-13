import { useState } from 'react';
import { Banner, Body, Button, Caption, Card, Heading, Screen, Stack, TextField, Voice } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { space } from '@/ui/theme';

export default function Account() {
  const { session, signOut } = useAuth();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = async () => {
    setError(null);
    if (confirm.trim().toUpperCase() !== 'DELETE') { setError('Type DELETE to confirm.'); return; }
    setBusy(true);
    try {
      // Runs on the server with the service role: removes your uploads, hands
      // over any family you own, then deletes your account.
      const { error: e } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
      if (e) throw e;
      await signOut();
    } catch (e) {
      setError(friendlyError(e, 'We couldn’t delete your account just now. Nothing has been removed. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.lg}>
        <Card>
          <Stack gap={space.md}>
            <Heading>Your privacy</Heading>
            <Voice>Everything in Robin belongs to a private family group. Photos and videos are stored privately and only open for people allowed to see them, through links that expire.</Voice>
            <Body>Robin doesn't ask for details about your children, and nothing is ever public.</Body>
            <Caption>Signed in as {session?.user.email ?? 'your account'}.</Caption>
          </Stack>
        </Card>

        <Card>
          <Stack gap={space.md}>
            <Heading>Delete your account</Heading>
            <Body>This permanently deletes your account and the photos and videos you uploaded. If you own a family, the next parent becomes its owner. Your old messages will show as from a former member. Families where you're the only member are deleted.</Body>
            {error ? <Banner tone="error" text={error} /> : null}
            <TextField label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
            <Button label="Delete my account" variant="danger" loading={busy} onPress={deleteAccount} />
          </Stack>
        </Card>

        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </Stack>
    </Screen>
  );
}
