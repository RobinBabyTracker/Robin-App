import { useState } from 'react';
import { Banner, Button, Stack, TextField } from '@/ui/components';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { useFamily } from '@/state/family';
import { space } from '@/ui/theme';

export function CreateFamilyForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const { refetch, select } = useFamily();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameErr = touched && !name.trim() ? 'Give your family group a name.' : null;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!name.trim()) return;
    setBusy(true);
    try {
      const id = await rpc<string>('create_family', { p_name: name.trim(), p_relation_label: label.trim() || null });
      select(id);
      await refetch();
      onCreated?.(id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={space.lg}>
      {error ? <Banner tone="error" text={error} /> : null}
      <TextField label="Family name" value={name} onChangeText={setName} placeholder="The Parkers" error={nameErr} maxLength={60} />
      <TextField label="What does your family call you? (optional)" value={label} onChangeText={setLabel} placeholder="Mum, Dad, Jess…" maxLength={40} />
      <Button label="Create family" loading={busy} onPress={submit} />
    </Stack>
  );
}
