import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Caption, Card, ErrorState, Loading, Screen, Section, Stack, ToggleRow } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { keys, usePrefs } from '@/state/queries';
import { supabase } from '@/lib/supabase';
import { updatePref } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { registerForPush, type PushResult } from '@/lib/push';
import type { NotificationPrefs } from '@/lib/types';
import { space } from '@/ui/theme';

const ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'task_requests', label: 'Requests for help and invitations', hint: 'When someone asks you for a hand or invites you.' },
  { key: 'task_updates', label: 'Replies and assignments', hint: 'When someone says yes, a request is covered, or a helper can’t make it.' },
  { key: 'event_changes', label: 'Changes and cancellations', hint: 'When plans you’re part of move or are cancelled.' },
  { key: 'messages', label: 'Messages', hint: 'New messages in your chats. You can also mute single chats.' },
  { key: 'reminders', label: 'Reminders', hint: 'A nudge before things you’re part of.' },
];

const PUSH_COPY: Record<PushResult, string> = {
  registered: 'Push notifications are on for this device.',
  denied: 'Notifications are turned off for Robin in your phone’s settings.',
  unsupported: 'Push notifications need a real phone (not a simulator).',
  not_configured: 'Push notifications aren’t set up in this build yet. You’ll still see everything in the notification centre.',
  error: 'We couldn’t turn on push notifications. Please try again.',
};

export default function NotificationSettings() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const prefs = usePrefs(userId);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushResult | null>(null);
  const [checking, setChecking] = useState(false);

  const set = async (key: keyof NotificationPrefs, value: boolean) => {
    setError(null);
    const prev = prefs.data;
    qc.setQueryData(keys.prefs, { ...prev, [key]: value });
    try {
      await updatePref(supabase, userId!, key, value);
    } catch (e) {
      qc.setQueryData(keys.prefs, prev); // put the switch back: nothing was saved
      setError(friendlyError(e));
    }
  };

  if (prefs.isLoading) return <Screen><Loading /></Screen>;
  if (prefs.error || !prefs.data) return <Screen><ErrorState error={prefs.error} onRetry={() => prefs.refetch()} /></Screen>;

  return (
    <Screen>
      <Stack gap={space.md}>
        {error ? <Banner tone="error" text={error} /> : null}
        <Caption>These control both the notification centre and push notifications.</Caption>
        <Card style={{ paddingVertical: 0, paddingHorizontal: 0 }}>
          {ROWS.map((r) => (
            <ToggleRow key={r.key} label={r.label} hint={r.hint} value={!!prefs.data![r.key]} onValueChange={(v) => set(r.key, v)} />
          ))}
        </Card>
        <Section title="Push notifications">
          <Card style={{ paddingVertical: 0, paddingHorizontal: 0 }}>
            <ToggleRow label="Send to my phone" hint="Turn off to only see notifications inside Robin." value={prefs.data.push_enabled} onValueChange={(v) => set('push_enabled', v)} />
          </Card>
          {push ? <Banner tone={push === 'registered' ? 'success' : 'info'} text={PUSH_COPY[push]} /> : null}
          <Button label="Check this device" variant="secondary" small loading={checking} onPress={async () => { setChecking(true); setPush(await registerForPush()); setChecking(false); }} />
        </Section>
      </Stack>
    </Screen>
  );
}
