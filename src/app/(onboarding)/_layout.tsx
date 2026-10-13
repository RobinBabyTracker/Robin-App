import { Stack } from 'expo-router';
import { colors, fonts } from '@/ui/theme';

export default function OnboardingLayout() {
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
      <Stack.Screen name="start" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ title: 'Join a family' }} />
    </Stack>
  );
}
