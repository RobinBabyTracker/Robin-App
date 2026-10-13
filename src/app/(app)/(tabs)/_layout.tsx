import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Icon, type IconName } from '@/ui/Icon';
import { colors, fonts } from '@/ui/theme';
import { useFamily } from '@/state/family';
import { useConversations } from '@/state/queries';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 4, borderRadius: 999, backgroundColor: focused ? colors.background : 'transparent' }}>
      <Icon name={name} size={22} color={focused ? colors.primary : colors.text} strokeWidth={focused ? 2.2 : 2} />
    </View>
  );
}

export default function TabsLayout() {
  const { familyId } = useFamily();
  const convs = useConversations(familyId);
  const unread = (convs.data ?? []).reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 84, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} /> }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} /> }} />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ focused }) => <TabIcon name="chat" focused={focused} />,
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 11 },
          tabBarAccessibilityLabel: unread > 0 ? `Messages, ${unread} unread chats` : 'Messages',
        }}
      />
      <Tabs.Screen name="memories" options={{ title: 'Memories', tabBarIcon: ({ focused }) => <TabIcon name="image" focused={focused} /> }} />
    </Tabs>
  );
}
