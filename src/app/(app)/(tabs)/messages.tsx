import { useState } from 'react';
import { RefreshControl, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AppHeader } from '@/components/AppHeader';
import { Avatar, Button, Caption, Card, EmptyState, ErrorState, ListRow, Loading, Screen, Stack } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useConversations, useMembers } from '@/state/queries';
import { timeAgo } from '@/lib/time';
import { colors, fonts, radius, space } from '@/ui/theme';

export default function Messages() {
  const { userId, timezone } = useAuth();
  const { familyId, current } = useFamily();
  const convs = useConversations(familyId);
  const members = useMembers(familyId);
  const [search, setSearch] = useState('');

  const nameOf = (uid: string | null) => (uid === userId ? 'You' : members.data?.find((m) => m.user_id === uid)?.profile?.display_name ?? 'Former member');
  const titleOf = (c: { kind: string; name: string | null; other_user: string | null }) => (c.kind === 'group' ? c.name ?? 'Group chat' : nameOf(c.other_user));

  const q = search.trim().toLowerCase();
  const list = (convs.data ?? []).filter((c) => !q || titleOf(c).toLowerCase().includes(q) || (c.last_body ?? '').toLowerCase().includes(q));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Messages" />
      <Screen refreshControl={<RefreshControl refreshing={convs.isRefetching} onRefresh={() => convs.refetch()} />}>
        <Stack gap={space.md}>
          <Button label="New chat or group" icon="plus" onPress={() => router.push('/chat/new')} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: radius.sm + 2, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.textSecondary }}>
            <Icon name="search" size={20} color={colors.textSecondary} />
            <TextInput
              accessibilityLabel="Search chats"
              returnKeyType="search"
              maxFontSizeMultiplier={2}
              placeholder="Search people and chats"
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={setSearch}
              style={{ flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.text }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Icon name="lock" size={14} color={colors.textSecondary} />
            <Caption>Only people in {current?.name ?? 'your family'} can be in these chats</Caption>
          </View>

          {convs.isLoading ? <Loading /> : convs.error ? <ErrorState error={convs.error} onRetry={() => convs.refetch()} /> : list.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {list.map((c, i) => {
                const title = titleOf(c);
                const preview = c.last_body ?? (c.last_has_media ? 'Photo or video' : c.last_message_at ? 'Message deleted' : 'No messages yet');
                const sender = c.kind === 'group' && c.last_sender ? `${nameOf(c.last_sender)}: ` : c.last_sender === userId ? 'You: ' : '';
                return (
                  <ListRow
                    key={c.id}
                    last={i === list.length - 1}
                    chevron={false}
                    title={title}
                    subtitle={`${sender}${preview}`}
                    accessibilityLabel={`${title}${c.unread_count ? `, ${c.unread_count} unread` : ''}. ${sender}${preview}`}
                    left={c.kind === 'group'
                      ? <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' }}><Icon name="people" color={colors.cream} /></View>
                      : <Avatar name={title} size={48} />}
                    right={
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        {c.last_message_at ? <Caption style={c.unread_count ? { color: colors.primary, fontFamily: fonts.bold } : undefined}>{timeAgo(c.last_message_at, timezone)}</Caption> : null}
                        {c.unread_count ? (
                          <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                            <Caption style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 12 }}>{c.unread_count > 99 ? '99+' : String(c.unread_count)}</Caption>
                          </View>
                        ) : c.muted_until && new Date(c.muted_until) > new Date() ? <Caption>Muted</Caption> : null}
                      </View>
                    }
                    onPress={() => router.push(`/chat/${c.id}`)}
                  />
                );
              })}
            </Card>
          ) : q ? (
            <Caption>No chats match "{search}".</Caption>
          ) : (
            <EmptyState title="No chats yet" body="Start a chat with one person, or a group for the whole family." action={{ label: 'Start a chat', icon: 'chat', onPress: () => router.push('/chat/new') }} />
          )}
        </Stack>
      </Screen>
    </View>
  );
}
