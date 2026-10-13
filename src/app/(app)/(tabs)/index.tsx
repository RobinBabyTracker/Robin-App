import { useMemo } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { AppHeader } from '@/components/AppHeader';
import { AskForHelpButton } from '@/components/AskForHelpButton';
import { RequestCard, TaskRow } from '@/components/tasks';
import { EmptyState, ErrorState, Loading, RobinNote, Screen, Section, Stack, Strong } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useCalendar, useConversations, useNames } from '@/state/queries';
import { dayRangeUtc, todayIn, addDays, zonedParts } from '@/lib/time';
import type { CalendarItem } from '@/lib/types';
import { colors, radius, space } from '@/ui/theme';

function greeting(tz: string) {
  const h = zonedParts(new Date(), tz).hour;
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

function robinSays(needsReply: CalendarItem[], upcoming: CalendarItem[], helping: CalendarItem[], name: (id: string | null) => string): string {
  if (needsReply.length === 1) return 'One request is waiting for you. No rush, and it’s fine to say no.';
  if (needsReply.length > 1) return `${needsReply.length} requests are waiting for you. Answer whichever you can.`;
  const covered = upcoming.find((i) => i.my_role === 'organiser' && i.kind === 'help' && i.status === 'confirmed');
  if (covered) return `Good news: ${covered.title.toLowerCase()} is covered, so that’s one less thing to think about.`;
  if (helping.length) return `You’re helping with ${helping.length === 1 ? helping[0].title.toLowerCase() : `${helping.length} things`} this week. Thank you!`;
  if (!upcoming.length) return 'A quiet week ahead. If you need a hand with anything, just ask.';
  return 'Here’s what’s coming up. I’ll let you know if anything changes.';
}

export default function Home() {
  const { profile, timezone, userId } = useAuth();
  const { familyId, isParent } = useFamily();
  const name = useNames(familyId);
  const today = todayIn(timezone);
  const range = useMemo(() => dayRangeUtc(today, addDays(today, 13), timezone), [today.year, today.month, today.day, timezone]);
  const cal = useCalendar(familyId, range.from, range.to, 'mine');
  const convs = useConversations(familyId);

  const items = (cal.data ?? []).filter((i) => new Date(i.ends_at).getTime() >= Date.now());
  const needsReply = items.filter((i) => i.my_role === 'invited' && !i.my_response && i.status === 'open');
  const upcoming = items.filter((i) => i.my_role !== 'invited' && i.status !== 'draft').slice(0, 6);
  const helping = items.filter((i) => i.my_role === 'helper' && i.status !== 'cancelled');
  const unreadChats = (convs.data ?? []).filter((c) => c.unread_count > 0);
  const unreadTotal = unreadChats.reduce((n, c) => n + c.unread_count, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title={`${greeting(timezone)}${profile ? `, ${profile.display_name.split(' ')[0]}` : ''}`} />
      <Screen refreshControl={<RefreshControl refreshing={cal.isRefetching} onRefresh={() => { cal.refetch(); convs.refetch(); }} />}>
        {cal.isLoading ? <Loading /> : cal.error ? <ErrorState error={cal.error} onRetry={() => cal.refetch()} /> : (
          <>
            <RobinNote text={robinSays(needsReply, upcoming, helping, name)} />

            {needsReply.length ? (
              <Section title={`Needs your reply · ${needsReply.length}`}>
                <Stack gap={space.md}>
                  {needsReply.map((i) => <RequestCard key={i.id} item={i} tz={timezone} familyId={familyId} fromName={name(i.created_by)} />)}
                </Stack>
              </Section>
            ) : null}

            <Section title="Coming up" action={<Pressable accessibilityRole="link" onPress={() => router.push('/calendar')} hitSlop={12}><Strong style={{ color: colors.primary, fontSize: 15 }}>See calendar</Strong></Pressable>}>
              {upcoming.length ? (
                <Stack gap={space.sm}>{upcoming.map((i) => <TaskRow key={i.id} item={i} tz={timezone} />)}</Stack>
              ) : (
                <EmptyState
                  pose="standing"
                  title="Nothing planned yet"
                  body={isParent ? 'When you ask for help or plan something, it will show up here.' : 'When your family asks for a hand, it will show up here.'}
                />
              )}
            </Section>

            {unreadTotal > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(unreadChats.length === 1 ? `/chat/${unreadChats[0].id}` : '/messages')}
                style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              >
                <Strong>{unreadTotal} new message{unreadTotal === 1 ? '' : 's'}</Strong>
                <Icon name="chevronRight" />
              </Pressable>
            ) : null}
          </>
        )}
      </Screen>
      {isParent ? <AskForHelpButton /> : null}
    </View>
  );
}
