import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Loading, Screen, Stack, TextField } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { validateDisplayName } from '@/lib/forms';
import { deviceTimeZone } from '@/lib/time';
import { space } from '@/ui/theme';

export default function ProfileSettings() {
  const { profile, userId } = useAuth();
  const { current, familyId, refetch } = useFamily();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [tz, setTz] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const device = deviceTimeZone();

  useEffect(() => {
    if (profile) { setName(profile.display_name); setTz(profile.timezone); }
    setLabel(current?.relation_label ?? '');
  }, [profile, current?.relation_label]);

  if (!profile) return <Screen><Loading /></Screen>;

  const save = async () => {
    setError(null); setSaved(false);
    const nameErr = validateDisplayName(name);
    if (nameErr) { setError(nameErr); return; }
    setBusy(true);
    try {
      await rpc('update_profile', { p_display_name: name.trim(), p_timezone: tz.trim() });
      if (familyId && (label.trim() || null) !== (current?.relation_label ?? null)) {
        await rpc('set_relation_label', { p_family: familyId, p_label: label.trim() || null });
        await refetch();
      }
      await qc.invalidateQueries({ queryKey: ['profile', userId] });
      qc.invalidateQueries({ queryKey: ['members'] });
      setSaved(true);
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
        {saved ? <Banner tone="success" text="Saved." /> : null}
        <Card>
          <Stack gap={space.lg}>
            <TextField label="Your name" value={name} onChangeText={setName} maxLength={60} />
            {current ? <TextField label={`What ${current.name} calls you (optional)`} value={label} onChangeText={setLabel} maxLength={40} placeholder="Nana, Dad…" /> : null}
            <TextField label="Time zone" value={tz} onChangeText={setTz} autoCapitalize="none" autoCorrect={false} hint="Times in Robin are shown in this zone, e.g. Australia/Brisbane." />
            {device !== tz ? <Button label={`Use this device's: ${device.replace(/_/g, ' ')}`} variant="text" onPress={() => setTz(device)} style={{ alignSelf: 'flex-start' }} /> : null}
          </Stack>
        </Card>
        <Button label="Save" loading={busy} onPress={save} />
      </Stack>
    </Screen>
  );
}
