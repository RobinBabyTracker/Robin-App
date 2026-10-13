import { Stack } from 'expo-router';
import { colors, fonts } from '@/ui/theme';

export default function AuthLayout() {
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
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create your account' }} />
      <Stack.Screen name="sign-in" options={{ title: 'Welcome back' }} />
      <Stack.Screen name="forgot" options={{ title: 'Reset your password' }} />
      <Stack.Screen name="verify" options={{ title: 'Check your email' }} />
    </Stack>
  );
}
