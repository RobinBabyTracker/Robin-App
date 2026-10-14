import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Heading, Robin, Screen, Stack, Title, Voice } from '@/ui/components';
import { CreateFamilyForm } from '@/components/CreateFamilyForm';
import { getPendingInvite } from '@/lib/pendingInvite';
import { useAuth } from '@/state/auth';
import { space } from '@/ui/theme';

export default function Start() {
  const { profile, signOut } = useAuth();

  useEffect(() => {
    const token = getPendingInvite();
    if (token) router.push(`/invite/${token}`);
  }, []);

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xl }}>
        <Robin pose="standing" size={110} />
        <Title style={{ textAlign: 'center' }}>Hello{profile ? `, ${profile.display_name}` : ''}!</Title>
        <Voice style={{ textAlign: 'center' }}>
          Robin works around a private family group. Only people you invite can see what's inside.
        </Voice>
      </View>
      <Stack gap={space.lg} style={{ marginTop: space.xl }}>
        <Card>
          <Stack gap={space.md}>
            <Heading>Start a family group</Heading>
            <CreateFamilyForm />
          </Stack>
        </Card>
        <Card>
          <Stack gap={space.md}>
            <Heading>Been invited?</Heading>
            <Voice>If someone sent you a code, you can join their family.</Voice>
            <Button label="I have an invite code" variant="secondary" onPress={() => router.push('/join')} />
          </Stack>
        </Card>
        <Button label="Sign out" variant="text" onPress={signOut} />
      </Stack>
    </Screen>
  );
}
