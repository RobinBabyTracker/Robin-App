import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Push notifications are an addition to the in-app notification centre, which
// works on its own. Push needs: a development or store build (Expo Go on
// Android no longer supports it), an EAS project id, Firebase (FCM)
// credentials for Android, and the send-push edge function deployed.
// See README > "Push notifications".
//
// expo-notifications is loaded lazily: in Expo Go on Android merely importing
// it throws, which would stop the whole app from opening.

type NotificationsModule = typeof import('expo-notifications');

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const pushAvailable = !(inExpoGo && Platform.OS === 'android');

let mod: NotificationsModule | null = null;
function notifications(): NotificationsModule | null {
  if (!pushAvailable) return null;
  if (!mod) {
    try {
      mod = require('expo-notifications') as NotificationsModule;
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: true,
        }),
      });
    } catch {
      mod = null;
    }
  }
  return mod;
}

let registeredToken: string | null = null;

export type PushResult = 'registered' | 'denied' | 'unsupported' | 'not_configured' | 'error';

export async function registerForPush(): Promise<PushResult> {
  try {
    const Notifications = notifications();
    if (!Notifications || !Device.isDevice) return 'unsupported';
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

/** Calls back when someone taps a push notification. Returns an unsubscribe function. */
export function onNotificationTap(cb: (data: { taskId?: string; conversationId?: string }) => void): () => void {
  const Notifications = notifications();
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    cb((r.notification.request.content.data ?? {}) as { taskId?: string; conversationId?: string });
  });
  return () => sub.remove();
}