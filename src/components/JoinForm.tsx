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
    if (!token) { setError('That doesn’t look like an invite code. It’s 8 letters and numbers, like K7PQ-2MXR.'); return; }
    setError(null);
    router.push(`/invite/${token}`);
  };
  return (
    <Stack gap={space.lg}>
      <Voice>Type in the invite code you were sent. It’s 8 letters and numbers, like K7PQ-2MXR. You can paste the whole message too.</Voice>
      <TextField label="Invite code" value={value} onChangeText={setValue} autoCapitalize="characters" autoCorrect={false} autoComplete="off" placeholder="K7PQ-2MXR" error={error} onSubmitEditing={go} returnKeyType="go" />
      <Button label="Continue" onPress={go} />
    </Stack>
  );
}
