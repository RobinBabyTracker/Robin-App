import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Avatar, Banner, Button, Caption, Card, ChoiceChip, ErrorState, ListRow, Loading, Screen, Section, Stack, TextField, ToggleRow,
} from '@/ui/components';
import { MediaThumb, MediaViewer } from '@/components/media';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { keys, useConversation, useMembers, useSharedMedia } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import type { Media } from '@/lib/types';
import { space } from '@/ui/theme';

const FOREVER = '2999-01-01T00:00:00Z';

export default function ChatDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { familyId } = useFamily();
  const qc = useQueryClient();
  const conv = useConversation(id);
  const members = useMembers(familyId);
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Media | null>(null);

  const shared = useSharedMedia(id);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setError(null); setNotice(null); setBusy(key);
    try {
      await fn();
      setNotice(ok);
      qc.invalidateQueries({ queryKey: keys.conversation(id) });
      qc.invalidateQueries({ queryKey: keys.conversations(familyId) });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  if (conv.isLoading) return <Screen><Loading /></Screen>;
  if (conv.error || !conv.data) return <Screen><ErrorState error={conv.error ?? new Error('not_found')} onRetry={() => conv.refetch()} /></Screen>;
  const c = conv.data;
  const me = c.members.find((m) => m.user_id === userId);
  const muted = !!me?.muted_until && new Date(me.muted_until) > new Date();
  const nameOf = (uid: string) => (uid === userId ? 'You' : members.data?.find((m) => m.user_id === uid)?.profile?.display_name ?? 'Former member');
  const notInChat = (members.data ?? []).filter((m) => !c.members.some((x) => x.user_id === m.user_id));

  return (
    <Screen>
      <Stack gap={space.lg}>
        {error ? <Banner tone="error" text={error} /> : null}
        {notice ? <Banner tone="success" text={notice} /> : null}

        {c.kind === 'group' ? (
          <Card>
            <Stack gap={space.md}>
              <TextField label="Group name" value={name ?? c.name ?? ''} onChangeText={setName} maxLength={60} />
              <Button label="Save name" variant="secondary" loading={busy === 'rename'} disabled={name === null || !name.trim()}
                onPress={() => run('rename', () => rpc('rename_conversation', { p_conversation: id, p_name: name!.trim() }), 'Name saved.')} />
            </Stack>
          </Card>
        ) : null}

        <Card>
          <ToggleRow
            label="Mute notifications"
            hint={muted ? 'You won’t be notified about new messages here.' : 'You’ll be notified about new messages.'}
            value={muted}
            onValueChange={(v) => run('mute', () => rpc('set_conversation_muted', { p_conversation: id, p_until: v ? FOREVER : null }), v ? 'Muted.' : 'Notifications back on.')}
          />
        </Card>

        <Section title={`People · ${c.members.length}`}>
          <Card style={{ padding: 0 }}>
            {c.members.map((m, i) => (
              <ListRow key={m.user_id} title={nameOf(m.user_id)} left={<Avatar name={nameOf(m.user_id)} size={40} />} last={i === c.members.length - 1} />
            ))}
          </Card>
        </Section>

        {c.kind === 'group' && notInChat.length ? (
          <Section title="Add people">
            <View style={{ gap: space.sm }}>
              {notInChat.map((m) => (
                <ChoiceChip key={m.user_id} label={m.profile?.display_name ?? 'Someone'} selected={adding.includes(m.user_id)}
                  onPress={() => setAdding((a) => (a.includes(m.user_id) ? a.filter((x) => x !== m.user_id) : [...a, m.user_id]))} />
              ))}
              <Button label="Add to group" variant="secondary" disabled={!adding.length} loading={busy === 'add'}
                onPress={() => run('add', () => rpc('add_conversation_members', { p_conversation: id, p_members: adding }), 'Added.').then(() => setAdding([]))} />
            </View>
          </Section>
        ) : null}

        <Section title="Shared photos and videos">
          {shared.isLoading ? <Loading /> : shared.error ? <ErrorState error={shared.error} onRetry={() => shared.refetch()} /> : shared.data?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {shared.data.map((m) => <MediaThumb key={m.id} media={m} size={104} onPress={() => setViewer(m)} />)}
            </View>
          ) : <Caption>Nothing shared in this chat yet.</Caption>}
        </Section>

        {c.kind === 'group' ? (
          <Button label="Leave group" icon="logout" variant="danger" loading={busy === 'leave'}
            onPress={() => run('leave', async () => { await rpc('leave_conversation', { p_conversation: id }); router.dismissTo('/messages'); }, 'You left the group.')} />
        ) : null}
      </Stack>
      <MediaViewer visible={!!viewer} media={viewer} onClose={() => setViewer(null)} />
    </Screen>
  );
}
