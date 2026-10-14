import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, Card, ErrorState, Loading, Robin, Screen, Stack, TextField, Title, Voice } from '@/ui/components';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { clearPendingInvite, setPendingInvite } from '@/lib/pendingInvite';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { space } from '@/ui/theme';

type Preview = { state: 'valid' | 'expired' | 'revoked' | 'used' | 'declined' | 'invalid'; family_name: string | null; invited_by_name: string | null; role: string | null };

const STATE_COPY: Record<Exclude<Preview['state'], 'valid'>, string> = {
  expired: 'This code has run out. Ask the person who invited you for a new one.',
  revoked: 'This invitation was cancelled. Ask for a new code if you still need one.',
  used: 'This code has already been used. Each code works for one person.',
  declined: 'This invitation was declined.',
  invalid: 'We couldn’t find that code. Check it and try again, or ask for a new one.',
};

export default function InviteScreen() {
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const { session } = useAuth();
  const { refetch, select, families } = useFamily();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session && token) setPendingInvite(token);
  }, [session, token]);

  const preview = useQuery({
    queryKey: ['invitePreview', token],
    enabled: !!session && !!token,
    queryFn: async () => (await rpc<Preview[]>('preview_invitation', { p_token: token }))[0],
  });

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!session) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={{ alignItems: 'center', gap: space.lg, marginTop: space.xxl }}>
          <Robin pose="flying" size={120} />
          <Title style={{ textAlign: 'center' }}>You've been invited</Title>
          <Voice style={{ textAlign: 'center' }}>Sign in or create an account and we'll take you straight to your invitation.</Voice>
          <Button label="Continue" onPress={() => router.replace('/welcome')} style={{ alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  const accept = async () => {
    setError(null);
    setBusy('accept');
    try {
      const familyId = await rpc<string>('accept_invitation', { p_token: token, p_relation_label: label.trim() || null });
      if (!familyId) throw new Error('invite_invalid');
      clearPendingInvite();
      select(familyId);
      await refetch();
      router.replace('/');
    } catch (e) {
      setError(friendlyError(e));
      if (String((e as Error).message).startsWith('already_member')) clearPendingInvite();
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setError(null);
    setBusy('decline');
    try {
      await rpc('decline_invitation', { p_token: token });
      clearPendingInvite();
      close();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      {preview.isLoading ? <Loading /> : preview.error ? (
        <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
      ) : preview.data?.state !== 'valid' ? (
        <View style={{ alignItems: 'center', gap: space.lg, marginTop: space.xxl }}>
          <Robin pose="pecking" size={110} />
          <Title style={{ textAlign: 'center' }}>That code can’t be used</Title>
          <Voice style={{ textAlign: 'center' }}>{STATE_COPY[(preview.data?.state ?? 'invalid') as Exclude<Preview['state'], 'valid'>]}</Voice>
          <Button label="Close" variant="secondary" onPress={() => { clearPendingInvite(); close(); }} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <Stack gap={space.lg} style={{ marginTop: space.xl }}>
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Robin pose="singing" size={120} />
            <Title style={{ textAlign: 'center' }}>Join {preview.data.family_name}?</Title>
            <Voice style={{ textAlign: 'center' }}>
              {preview.data.invited_by_name} invited you to their family on Robin
              {preview.data.role === 'parent' ? ' as a parent.' : ' as a helper.'}
            </Voice>
          </View>
          {error ? <Banner tone="error" text={error} /> : null}
          <Card>
            <TextField label="What does the family call you? (optional)" value={label} onChangeText={setLabel} placeholder="Nana, Uncle Tom…" maxLength={40} />
          </Card>
          <Button label="Join family" loading={busy === 'accept'} disabled={busy === 'decline'} onPress={accept} />
          <Button label="No thanks" variant="secondary" loading={busy === 'decline'} disabled={busy === 'accept'} onPress={decline} />
          {families.length > 0 ? <Button label="Decide later" variant="text" onPress={close} /> : null}
        </Stack>
      )}
    </Screen>
  );
}
