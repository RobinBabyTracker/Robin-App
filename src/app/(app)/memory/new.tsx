import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Caption, Card, Screen, Stack, TextField, ToggleRow, Voice } from '@/ui/components';
import { PendingUpload } from '@/components/media';
import { DateTimeField } from '@/components/DateTimeField';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { keys } from '@/state/queries';
import { useUploads } from '@/state/useUploads';
import { pickMedia, takePhoto } from '@/lib/upload';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { dateKey, todayIn, type LocalDateTime } from '@/lib/time';
import { space } from '@/ui/theme';

export default function NewMemory() {
  const { task } = useLocalSearchParams<{ task?: string }>();
  const { timezone } = useAuth();
  const { familyId, isParent } = useFamily();
  const qc = useQueryClient();
  const uploads = useUploads(familyId);
  const [caption, setCaption] = useState('');
  const [date, setDate] = useState<LocalDateTime>({ ...todayIn(timezone), hour: 12, minute: 0 });
  const [parentsOnly, setParentsOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (source: 'library' | 'camera') => {
    setError(null);
    const res = source === 'camera' ? await takePhoto() : await pickMedia({ multiple: true });
    if (res === 'denied') { setError('Robin needs permission to use your photos or camera. You can allow it in Settings.'); return; }
    if (res) uploads.add(res);
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    const saved: string[] = [];
    try {
      for (const mediaId of uploads.mediaIds) {
        await rpc('add_memory', {
          p_media: mediaId, p_caption: caption.trim() || null, p_taken_on: dateKey(date),
          p_visibility: parentsOnly ? 'parents_only' : 'family', p_source_task: task ?? null,
        });
        saved.push(mediaId);
      }
      qc.invalidateQueries({ queryKey: keys.memories(familyId) });
      router.back();
    } catch (e) {
      qc.invalidateQueries({ queryKey: keys.memories(familyId) });
      setError(saved.length ? `${saved.length} saved, but the rest didn’t: ${friendlyError(e)}` : friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.lg}>
        {error ? <Banner tone="error" text={error} /> : null}
        {!uploads.entries.length ? <Voice>Choose photos or videos (up to 3 minutes each). They're stored privately for your family.</Voice> : (
          <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
            {uploads.entries.map((e) => (
              <PendingUpload key={e.item.key} item={e.item} state={e.state} onRetry={() => uploads.retry(e.item.key)} onRemove={() => uploads.remove(e.item.key)} />
            ))}
          </ScrollView>
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Choose" accessibilityLabel="Choose photos or videos" icon="image" variant="secondary" onPress={() => add('library')} style={{ flex: 1 }} />
          <Button label="Camera" accessibilityLabel="Take a photo or video" icon="camera" variant="secondary" onPress={() => add('camera')} style={{ flex: 1 }} />
        </View>
        <Card>
          <Stack gap={space.lg}>
            <TextField label="Caption (optional)" value={caption} onChangeText={setCaption} maxLength={500} multiline placeholder="First trip to the beach" />
            <DateTimeField label="When was this?" value={date} onChange={setDate} dateOnly />
            {isParent ? (
              <ToggleRow label="Only parents can see" hint="Hide these from helpers in your family." value={parentsOnly} onValueChange={setParentsOnly} />
            ) : <Caption>Everyone in your family will be able to see these.</Caption>}
          </Stack>
        </Card>
        {uploads.busy ? <Caption>Uploading… you can save once everything has finished.</Caption> : null}
        {uploads.failed ? <Caption>Retry or remove anything that didn't upload, then save.</Caption> : null}
        <Button label={uploads.mediaIds.length > 1 ? `Save ${uploads.mediaIds.length} memories` : 'Save memory'} loading={saving} disabled={!uploads.ready} onPress={save} />
      </Stack>
    </Screen>
  );
}
