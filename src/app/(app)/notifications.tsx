import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Caption, EmptyState, ErrorState, Loading, Screen, Stack, Strong } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { keys, useNotifications } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import type { Notification } from '@/lib/types';
import { colors, radius, space } from '@/ui/theme';

const ICONS: Record<string, IconName> = {
  task_request: 'people', event_invite: 'star', task_accepted: 'checkCircle', task_filled: 'checkCircle',
  helper_withdrew: 'alert', task_reopened: 'refresh', task_changed: 'pencil', task_cancelled: 'close',
  event_rsvp: 'check', message: 'chat', reminder: 'clock', no_helper_yet: 'clock', member_joined: 'person',
};

export default function Notifications() {
  const { userId, timezone } = useAuth();
  const { families, familyId, select } = useFamily();
  const qc = useQueryClient();
  const q = useNotifications(userId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;

  const open = async (n: Notification) => {
    if (!n.read_at) {
      rpc('mark_notifications_read', { p_ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: keys.notifications })).catch(() => {});
    }
    if (n.family_id && n.family_id !== familyId && families.some((f) => f.id === n.family_id)) select(n.family_id);
    if (n.conversation_id) router.push(`/chat/${n.conversation_id}`);
    else if (n.task_id) router.push(`/task/${n.task_id}`);
    else if (n.type === 'member_joined') router.push('/settings/family');
  };

  const markAll = async () => {
    setError(null); setBusy(true);
    try {
      await rpc('mark_notifications_read', { p_ids: null });
      await qc.invalidateQueries({ queryKey: keys.notifications });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
      <Stack gap={space.md}>
        {error ? <Banner tone="error" text={error} /> : null}
        {unread ? <Button label={`Mark all ${unread} as read`} variant="secondary" small loading={busy} onPress={markAll} style={{ alignSelf: 'flex-start' }} /> : null}
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data?.length ? (
          q.data.map((n) => (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.title}. ${n.body ?? ''}. ${timeAgo(n.created_at, timezone)}`}
              onPress={() => open(n)}
              style={({ pressed }) => ({
                flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg,
                backgroundColor: pressed ? colors.cream : colors.surface, borderWidth: n.read_at ? 1 : 2,
                borderColor: n.read_at ? colors.border : colors.primary,
              })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ICONS[n.type] ?? 'bell'} size={20} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Strong>{n.title}</Strong>
                {n.body ? <Caption numberOfLines={2}>{n.body}</Caption> : null}
                <Caption>{timeAgo(n.created_at, timezone)}{n.read_at ? '' : ' · New'}</Caption>
              </View>
            </Pressable>
          ))
        ) : (
          <EmptyState pose="standing" title="You're all caught up" body="Requests, replies and changes will show up here." />
        )}
      </Stack>
    </Screen>
  );
}
