import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Body, Button, Caption, Card, EmptyState, ErrorState, Loading, Pill, Screen, Stack, Strong, TextField, ToggleRow } from '@/ui/components';
import { MediaThumb, MediaViewer } from '@/components/media';
import { DateTimeField } from '@/components/DateTimeField';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { keys, useMemory, useNames } from '@/state/queries';
import { rpc, supabase, MEDIA_BUCKET } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { conversationIdForMessage } from '@/lib/api';
import { dateKey, formatDate, parseDateKey, type LocalDateTime } from '@/lib/time';
import { space } from '@/ui/theme';

export default function MemoryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { familyId, isParent } = useFamily();
  const qc = useQueryClient();
  const q = useMemory(id);
  const name = useNames(familyId);
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState('');
  const [date, setDate] = useState<LocalDateTime | null>(null);
  const [parentsOnly, setParentsOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState(false);

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const m = q.data;
  if (!m || !m.media) {
    return <Screen><EmptyState title="This memory isn't available" body="It may have been deleted, or it's only visible to parents." action={{ label: 'Back', onPress: () => router.back() }} /></Screen>;
  }
  const canEdit = m.added_by === userId || isParent;

  const startEdit = () => {
    setCaption(m.caption ?? '');
    setDate({ ...parseDateKey(m.taken_on), hour: 12, minute: 0 });
    setParentsOnly(m.visibility === 'parents_only');
    setEditing(true);
  };

  const save = async () => {
    setError(null); setBusy('save');
    try {
      await rpc('update_memory', { p_memory: m.id, p_caption: caption.trim() || null, p_taken_on: date ? dateKey(date) : null, p_visibility: parentsOnly ? 'parents_only' : 'family' });
      await q.refetch();
      qc.invalidateQueries({ queryKey: keys.memories(familyId) });
      setEditing(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setError(null); setBusy('delete');
    try {
      const path = await rpc<string | null>('delete_memory', { p_memory: m.id });
      // The file is already unreadable. Remove it from storage now if we uploaded it;
      // otherwise the scheduled cleanup removes it.
      if (path && m.media?.uploaded_by === userId) await supabase.storage.from(MEDIA_BUCKET).remove([path]);
      qc.invalidateQueries({ queryKey: keys.memories(familyId) });
      router.back();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(null);
    }
  };

  const openSource = async () => {
    if (m.source_task_id) { router.push(`/task/${m.source_task_id}`); return; }
    if (m.source_message_id) {
      const conv = await conversationIdForMessage(supabase, m.source_message_id).catch(() => null);
      if (conv) router.push(`/chat/${conv}`);
      else setError('That chat isn’t available to you.');
    }
  };

  return (
    <Screen>
      <RouterStack.Screen options={{ title: formatDate(parseDateKey(m.taken_on), { year: true }) }} />
      <Stack gap={space.lg}>
        {error ? <Banner tone="error" text={error} /> : null}
        <MediaThumb media={m.media} size={width - space.lg * 2} onPress={() => setViewing(true)} label={`${m.media.kind === 'photo' ? 'Photo' : 'Video'}. Open full screen`} />

        {!editing ? (
          <Card>
            <Stack gap={space.sm}>
              {m.caption ? <Body>{m.caption}</Body> : <Caption>No caption</Caption>}
              <Caption>Added by {m.added_by === userId ? 'you' : name(m.added_by)} · {formatDate(parseDateKey(m.taken_on), { weekday: true, year: true })}</Caption>
              {m.visibility === 'parents_only' ? <Pill tone="outline" icon="lock" label="Only parents can see this" /> : <Pill tone="pink" icon="people" label="Everyone in the family" />}
              {m.source_task_id || m.source_message_id ? (
                <Button label={m.source_task_id ? 'Open the event' : 'Open the chat'} variant="text" onPress={openSource} style={{ alignSelf: 'flex-start' }} />
              ) : null}
            </Stack>
          </Card>
        ) : (
          <Card>
            <Stack gap={space.lg}>
              <TextField label="Caption" value={caption} onChangeText={setCaption} maxLength={500} multiline />
              {date ? <DateTimeField label="Date" value={date} onChange={setDate} dateOnly /> : null}
              {isParent ? <ToggleRow label="Only parents can see" value={parentsOnly} onValueChange={setParentsOnly} /> : null}
              <Button label="Save" loading={busy === 'save'} onPress={save} />
              <Button label="Cancel" variant="text" onPress={() => setEditing(false)} />
            </Stack>
          </Card>
        )}

        {canEdit && !editing ? (
          <View style={{ gap: space.sm }}>
            <Button label="Edit details" icon="pencil" variant="secondary" onPress={startEdit} />
            {!confirmDelete ? (
              <Button label="Delete" icon="trash" variant="danger" onPress={() => setConfirmDelete(true)} />
            ) : (
              <Card>
                <Stack gap={space.md}>
                  <Strong>Delete this memory for everyone?</Strong>
                  <Caption>It will be removed from Memories straight away. If it was shared in a chat, it stays in that chat.</Caption>
                  <Button label="Yes, delete it" variant="danger" loading={busy === 'delete'} onPress={remove} />
                  <Button label="Keep it" variant="text" onPress={() => setConfirmDelete(false)} />
                </Stack>
              </Card>
            )}
          </View>
        ) : null}
      </Stack>
      <MediaViewer visible={viewing} media={m.media} caption={m.caption} onClose={() => setViewing(false)} />
    </Screen>
  );
}
