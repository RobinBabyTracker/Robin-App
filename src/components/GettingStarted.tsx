import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Button, Caption, Card, ProgressBar, Robin, Stack, Strong, Voice } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useConversations, useInvitations, useMembers, useMemories } from '@/state/queries';
import { guide, type GuideStep } from '@/lib/guide';
import type { CalendarItem } from '@/lib/types';
import { colors, radius, space } from '@/ui/theme';

type Step = { id: GuideStep; icon: IconName; title: string; hint: string; href: Href };

const PARENT_STEPS: Step[] = [
  { id: 'invite', icon: 'people', title: 'Invite your family', hint: 'Send a private link to the people who help you.', href: '/settings/invite' },
  { id: 'ask', icon: 'calendar', title: 'Ask for help or plan an event', hint: 'Once someone has joined, ask them for a hand.', href: '/task/new' },
  { id: 'message', icon: 'chat', title: 'Say hello in Messages', hint: 'Start a chat with one person or the group.', href: '/chat/new' },
  { id: 'memory', icon: 'image', title: 'Add your first memory', hint: 'Save a favourite photo or video.', href: '/memory/new' },
];

const HELPER_STEPS: Step[] = [
  { id: 'reply', icon: 'check', title: 'Answer a request', hint: 'When the family asks for a hand, it shows up on Home.', href: '/calendar' },
  { id: 'message', icon: 'chat', title: 'Say hello in Messages', hint: 'Start a chat with one person or the group.', href: '/chat/new' },
  { id: 'memory', icon: 'image', title: 'Add a memory', hint: 'Share a favourite photo or video with the family.', href: '/memory/new' },
];

/**
 * Robin's "Getting started" checklist on Home. Steps tick themselves off from
 * real activity, so people never have to mark anything done by hand.
 */
export function GettingStarted({ items }: { items: CalendarItem[] }) {
  const { userId } = useAuth();
  const { familyId, isParent } = useFamily();
  const members = useMembers(familyId);
  const invitations = useInvitations(familyId, isParent);
  const convs = useConversations(familyId);
  const memories = useMemories(familyId);

  const [hidden, setHidden] = useState(() => (userId ? guide.checklistHidden(userId) : true));
  const [stored, setStored] = useState(() => (userId ? guide.doneSteps(userId) : new Set<GuideStep>()));

  // Settings can switch the checklist back on, so re-check when Home is shown.
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    setHidden(guide.checklistHidden(userId));
    setStored(guide.doneSteps(userId));
  }, [userId]));

  const live = useMemo(() => {
    const now = Date.now();
    const done: GuideStep[] = [];
    const pendingInvite = (invitations.data ?? []).some((i) => !i.accepted_at && !i.declined_at && !i.revoked_at && new Date(i.expires_at).getTime() > now);
    if ((members.data?.length ?? 0) > 1 || pendingInvite) done.push('invite');
    if (items.some((i) => i.my_role === 'organiser')) done.push('ask');
    if (items.some((i) => i.my_role === 'helper' || (i.my_response !== null && i.my_role !== 'organiser'))) done.push('reply');
    if ((convs.data ?? []).some((c) => c.last_message_at)) done.push('message');
    if ((memories.data?.pages[0]?.length ?? 0) > 0) done.push('memory');
    return done;
  }, [members.data, invitations.data, items, convs.data, memories.data]);

  useEffect(() => {
    if (!userId || !live.length) return;
    guide.markDone(userId, live);
    setStored(guide.doneSteps(userId));
  }, [userId, live.join(',')]);

  if (!userId || hidden) return null;

  const steps = isParent ? PARENT_STEPS : HELPER_STEPS;
  const isDone = (s: Step) => stored.has(s.id) || live.includes(s.id);
  const doneCount = steps.filter(isDone).length;
  const allDone = doneCount === steps.length;
  const next = steps.find((s) => !isDone(s));

  const hide = () => {
    guide.setChecklistHidden(userId, true);
    setHidden(true);
  };

  return (
    <Card tone="cream" style={{ marginTop: space.lg }}>
      <Stack gap={space.md}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Robin pose={allDone ? 'singing' : 'flying'} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Strong accessibilityRole="header">{allDone ? 'You’re all set up' : 'Getting started'}</Strong>
            <Voice style={{ fontSize: 15, lineHeight: 21 }}>
              {allDone
                ? 'You’ve done the lot. Lovely work!'
                : next?.id === 'invite'
                  ? 'Start by inviting your family. I’ll tick things off as you go.'
                  : 'I’ll tick things off as you go.'}
            </Voice>
          </View>
        </View>

        <ProgressBar progress={doneCount / steps.length} label={`${doneCount} of ${steps.length} getting-started steps done`} />

        {!allDone ? (
          <View style={{ gap: space.sm }}>
            {steps.map((s) => {
              const done = isDone(s);
              const isNext = s === next;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.title}${done ? ', done' : ''}`}
                  accessibilityHint={done ? undefined : s.hint}
                  onPress={() => router.push(s.href)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56,
                    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm,
                    backgroundColor: colors.surface, borderWidth: isNext ? 2 : 1,
                    borderColor: isNext ? colors.primary : colors.border, opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? colors.text : colors.background }}>
                    <Icon name={done ? 'check' : s.icon} size={18} color={done ? colors.onPrimary : colors.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Strong style={done ? { color: colors.textSecondary, textDecorationLine: 'line-through' } : undefined}>{s.title}</Strong>
                    {isNext ? <Caption>{s.hint}</Caption> : null}
                  </View>
                  {!done ? <Icon name="chevronRight" size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Button
          label={allDone ? 'Hide this' : 'Hide checklist'}
          variant="text"
          small
          onPress={hide}
          style={{ alignSelf: 'flex-end' }}
          accessibilityHint="You can bring it back from You & family"
        />
      </Stack>
    </Card>
  );
}
