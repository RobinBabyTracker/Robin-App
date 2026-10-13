import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
// Import single weights so unused font files aren't bundled.
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display/400Regular';
import { SourceSerif4_400Regular } from '@expo-google-fonts/source-serif-4/400Regular';
import { Roboto_400Regular } from '@expo-google-fonts/roboto/400Regular';
import { Roboto_500Medium } from '@expo-google-fonts/roboto/500Medium';
import { Roboto_700Bold } from '@expo-google-fonts/roboto/700Bold';
import { AuthProvider, useAuth } from '@/state/auth';
import { FamilyProvider, useFamily } from '@/state/family';
import { isConfigured } from '@/lib/supabase';
import { colors, fonts } from '@/ui/theme';
import { Body, ErrorState, Loading, Robin, Screen, Title, Voice } from '@/ui/components';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    // Swap these for the licensed Ethic Serif and Questa files when available.
    [fonts.heading]: DMSerifDisplay_400Regular,
    [fonts.voice]: SourceSerif4_400Regular,
    [fonts.body]: Roboto_400Regular,
    [fonts.medium]: Roboto_500Medium,
    [fonts.bold]: Roboto_700Bold,
  });

  useEffect(() => {
    if (loaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, fontError]);

  if (!loaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FamilyProvider>
            <StatusBar style="dark" />
            {isConfigured ? <RootNavigator /> : <NotConfigured />}
          </FamilyProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, initialising } = useAuth();
  const { families, loading, error, refetch } = useFamily();
  const signedIn = !!session;

  if (initialising || (signedIn && loading)) {
    return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}><Loading /></View>;
  }
  if (signedIn && error) {
    return <Screen edges={['top', 'left', 'right']}><ErrorState error={error} onRetry={() => refetch()} /></Screen>;
  }
  const hasFamily = families.length > 0;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasFamily}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasFamily}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="invite/[token]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

function NotConfigured() {
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ alignItems: 'center', gap: 16, marginTop: 48 }}>
        <Robin pose="pecking" size={120} />
        <Title>Robin isn't connected yet</Title>
        <Voice style={{ textAlign: 'center' }}>
          Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to a .env file, then restart the app.
        </Voice>
        <Body style={{ textAlign: 'center' }}>See README.md, section "Connect Supabase".</Body>
      </View>
    </Screen>
  );
}
