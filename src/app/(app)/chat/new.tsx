import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Body, Button, Caption, ChoiceChip, EmptyState, ErrorState, Loading, Screen, Stack, TextField } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useMembers } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { space } from '@/ui/theme';

export default function NewChat() {
  const { userId } = useAuth();
  const { familyId } = useFamily();
  const members = useMembers(familyId);
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = (members.data ?? []).filter((m) => m.user_id !== userId);
  const isGroup = chosen.length > 1;

  const start = async () => {
    setError(null);
    if (!chosen.length) { setError('Choose at least one person.'); return; }
    setBusy(true);
    try {
      const id = await rpc<string>('create_conversation', { p_family: familyId, p_members: chosen, p_name: isGroup ? name.trim() || null : null });
      router.replace(`/chat/${id}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (members.isLoading) return <Screen><Loading /></Screen>;
  if (members.error) return <Screen><ErrorState error={members.error} onRetry={() => members.refetch()} /></Screen>;
  if (!others.length) {
    return <Screen><EmptyState title="No one to chat with yet" body="Invite family members first, then you can message them here." action={{ label: 'Invite someone', onPress: () => router.replace('/settings/invite') }} /></Screen>;
  }

  return (
    <Screen>
      <Stack gap={space.lg}>
        <Body>Who would you like to talk to?</Body>
        {error ? <Banner tone="error" text={error} /> : null}
        <View style={{ gap: space.sm }}>
          {others.map((m) => (
            <ChoiceChip
              key={m.user_id}
              label={`${m.profile?.display_name ?? 'Someone'}${m.relation_label ? ` (${m.relation_label})` : ''}`}
              selected={chosen.includes(m.user_id)}
              onPress={() => setChosen((c) => (c.includes(m.user_id) ? c.filter((x) => x !== m.user_id) : [...c, m.user_id]))}
            />
          ))}
        </View>
        {isGroup ? <TextField label="Group name (optional)" value={name} onChangeText={setName} maxLength={60} placeholder="Family Group" /> : null}
        <Caption>{isGroup ? 'A group chat with everyone you chose.' : chosen.length ? 'A private chat between the two of you.' : ''}</Caption>
        <Button label={isGroup ? 'Start group' : 'Start chat'} loading={busy} onPress={start} />
      </Stack>
    </Screen>
  );
}
