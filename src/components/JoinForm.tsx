import { useState } from 'react';
import { router } from 'expo-router';
import { Button, Stack, TextField, Voice } from '@/ui/components';
import { extractInviteToken } from '@/lib/forms';
import { space } from '@/ui/theme';

export function JoinForm() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const token = extractInviteToken(value);
    if (!token) { setError('That doesn’t look like a Robin invite link. Copy the whole link and try again.'); return; }
    setError(null);
    router.push(`/invite/${token}`);
  };
  return (
    <Stack gap={space.lg}>
      <Voice>Paste the invite link someone sent you. Each link works once and expires after a few days.</Voice>
      <TextField label="Invite link" value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} placeholder="robin://invite/…" error={error} />
      <Button label="Continue" onPress={go} />
    </Stack>
  );
}
