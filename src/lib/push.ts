import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Push notifications are an addition to the in-app notification centre, which
// works on its own. Push needs: an EAS project id, Firebase (FCM) credentials
// for Android uploaded to EAS, and the send-push edge function deployed.
// See README > "Push notifications".

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

let registeredToken: string | null = null;

export type PushResult = 'registered' | 'denied' | 'unsupported' | 'not_configured' | 'error';

export async function registerForPush(): Promise<PushResult> {
  try {
    if (!Device.isDevice) return 'unsupported';
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'not_configured';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Robin',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_device', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    });
    if (error) return 'error';
    registeredToken = token;
    return 'registered';
  } catch {
    return 'error';
  }
}

export async function unregisterPush() {
  if (!registeredToken) return;
  await supabase.rpc('unregister_push_device', { p_token: registeredToken });
  registeredToken = null;
}
