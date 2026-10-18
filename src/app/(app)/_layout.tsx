import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { IconButton } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useRealtime } from '@/state/realtime';
import { getPendingInvite } from '@/lib/pendingInvite';
import { onNotificationTap, registerForPush } from '@/lib/push';
import { guide } from '@/lib/guide';
import { colors, fonts } from '@/ui/theme';

// iPhone modals otherwise close only with a swipe down, which not everyone knows.
const modal = {
  presentation: 'modal' as const,
  ...(Platform.OS === 'ios' ? { headerLeft: () => <IconButton icon="close" label="Close" onPress={() => router.back()} /> } : {}),
};

export default function AppLayout() {
  const { userId, session } = useAuth();
  const { familyId } = useFamily();
  useRealtime(userId, familyId);

  useEffect(() => {
    const token = getPendingInvite();
    let tourTimer: ReturnType<typeof setTimeout> | undefined;
    if (token) router.push(`/invite/${token}`);
    // New accounts only: Robin shows a short welcome tour once Home has appeared.
    else if (session?.user && guide.shouldShowTour(session.user)) tourTimer = setTimeout(() => router.push('/tour'), 400);
    // Push is optional; the in-app notification centre works without it.
    registerForPush().catch(() => {});
    // Tapping a push notification opens the right screen.
    const stopTaps = onNotificationTap((d) => {
      if (d.conversationId) router.push(`/chat/${d.conversationId}`);
      else if (d.taskId) router.push(`/task/${d.taskId}`);
      else router.push('/notifications');
    });
    return () => {
      if (tourTimer) clearTimeout(tourTimer);
      stopTaps();
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.heading, fontSize: 20 },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="tour" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="task/new" options={{ title: 'Ask for help', ...modal }} />
      <Stack.Screen name="task/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="task/[id]/edit" options={{ title: 'Edit', ...modal }} />
      <Stack.Screen name="chat/new" options={{ title: 'New chat', ...modal }} />
      <Stack.Screen name="chat/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="chat/[id]/details" options={{ title: 'Chat details' }} />
      <Stack.Screen name="memory/new" options={{ title: 'Add memories', ...modal }} />
      <Stack.Screen name="memory/[id]" options={{ title: '' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings/index" options={{ title: 'You & family' }} />
      <Stack.Screen name="settings/profile" options={{ title: 'Your profile' }} />
      <Stack.Screen name="settings/family" options={{ title: 'Family members' }} />
      <Stack.Screen name="settings/invite" options={{ title: 'Invite someone', ...modal }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings/account" options={{ title: 'Privacy & account' }} />
      <Stack.Screen name="settings/families" options={{ title: 'Your families' }} />
      <Stack.Screen name="settings/join" options={{ title: 'Join a family' }} />
    </Stack>
  );
}