import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Caption, Display, IconButton } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useNotifications } from '@/state/queries';
import { colors, space } from '@/ui/theme';

export function AppHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { profile, userId } = useAuth();
  const { current, families } = useFamily();
  const notes = useNotifications(userId);
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;

  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          {families.length > 1 && current ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Current family: ${current.name}. Switch family`}
              onPress={() => router.push('/settings/families')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 }}
            >
              <Caption>{current.name}</Caption>
              <Icon name="chevronDown" size={14} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Display numberOfLines={2}>{title}</Display>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {right}
          <IconButton icon="bell" label={unread ? `Notifications, ${unread} unread` : 'Notifications'} badge={unread > 0} onPress={() => router.push('/notifications')} />
          <Pressable accessibilityRole="button" accessibilityLabel="You and your family" onPress={() => router.push('/settings')} style={{ padding: 2 }}>
            <View style={{ borderWidth: 2, borderColor: colors.text, borderRadius: 24 }}>
              <Avatar name={profile?.display_name} size={40} tone="cream" />
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
