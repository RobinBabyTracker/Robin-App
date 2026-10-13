import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Caption, Pill, Stack, Strong } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { colors, radius, space } from '@/ui/theme';
import { formatWhen, otherZoneHint } from '@/lib/time';
import { friendlyError } from '@/lib/errors';
import type { CalendarItem, TaskStatus } from '@/lib/types';
import type { TaskCategory, TaskKind } from '@/lib/forms';
import { useRespond, type RespondResult } from '@/state/queries';

export const CATEGORIES: { value: TaskCategory; label: string; icon: IconName }[] = [
  { value: 'childcare', label: 'Childcare', icon: 'person' },
  { value: 'meals', label: 'Meals', icon: 'meal' },
  { value: 'errands', label: 'Errands', icon: 'cart' },
  { value: 'appointment', label: 'Appointment', icon: 'medical' },
  { value: 'family_event', label: 'Family event', icon: 'star' },
  { value: 'other', label: 'Something else', icon: 'more' },
];
export const categoryOf = (c: TaskCategory) => CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[5];

type StatusLike = Pick<CalendarItem, 'kind' | 'status' | 'accepted_count' | 'helpers_needed' | 'tentative_count' | 'my_role'>;

/** Status shown with words and an icon, never colour alone. */
export function StatusPill({ item, helperName }: { item: StatusLike; helperName?: string | null }) {
  const s: TaskStatus = item.status;
  if (s === 'draft') return <Pill tone="dashed" icon="pencil" label="Draft" />;
  if (s === 'cancelled') return <Pill tone="muted" icon="close" label="Cancelled" />;
  if (s === 'completed') return <Pill tone="outline" icon="checkCircle" label="Done" />;
  if (item.kind === 'event') {
    const going = item.accepted_count;
    return <Pill tone="olive" icon="check" label={`${going} going${item.tentative_count ? ` · ${item.tentative_count} maybe` : ''}`} />;
  }
  if (s === 'confirmed') {
    if (item.my_role === 'helper') return <Pill tone="olive" icon="check" label="You're helping" />;
    return <Pill tone="olive" icon="check" label={helperName && item.helpers_needed === 1 ? `${helperName} is helping` : 'All covered'} />;
  }
  if (item.accepted_count > 0) return <Pill icon="clock" label={`${item.accepted_count} of ${item.helpers_needed} covered`} />;
  return <Pill icon="clock" label="Awaiting replies" />;
}

export function TaskRow({ item, tz, subtitle }: { item: CalendarItem; tz: string; subtitle?: string }) {
  const cat = categoryOf(item.category);
  const hint = otherZoneHint(item, tz);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${cat.label}, ${formatWhen(item, tz)}`}
      onPress={() => router.push(`/task/${item.id}`)}
      style={({ pressed }) => [{ flexDirection: 'row', gap: space.md, padding: space.lg, backgroundColor: pressed ? colors.cream : colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }]}
    >
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: item.status === 'cancelled' ? colors.disabledBg : colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={cat.icon} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Caption>{subtitle ?? `${cat.label} · ${formatWhen(item, tz)}`}</Caption>
        <Strong style={item.status === 'cancelled' ? { textDecorationLine: 'line-through' } : undefined}>{item.title}</Strong>
        {hint ? <Caption>{hint}</Caption> : null}
        <StatusPill item={item} />
      </View>
    </Pressable>
  );
}

export const RESULT_COPY: Record<RespondResult['result'], string> = {
  assigned: 'Thank you! It’s yours, and it’s on your calendar.',
  already_yours: 'You’ve already got this one. Thank you!',
  already_filled: 'Someone got there first, so this is covered. Thank you for offering!',
  recorded: 'Thanks, your reply has been sent.',
  withdrawn: 'No problem. We’ve let them know, and others can now offer.',
};

/** Reply buttons. The server decides the outcome; we only show what it says. */
export function RespondButtons({ familyId, taskId, kind, myResponse, onDone }: {
  familyId: string; taskId: string; kind: TaskKind; myResponse: string | null; onDone?: (r: RespondResult) => void;
}) {
  const respond = useRespond(familyId, taskId);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const send = async (r: 'accepted' | 'declined' | 'tentative') => {
    setMessage(null);
    setPending(r);
    try {
      const res = await respond.mutateAsync(r);
      setMessage({ tone: res.result === 'already_filled' ? 'info' : 'success', text: kind === 'event' && res.result === 'recorded' ? 'Thanks, your reply has been sent.' : RESULT_COPY[res.result] });
      onDone?.(res);
    } catch (e) {
      setMessage({ tone: 'error', text: friendlyError(e) });
    } finally {
      setPending(null);
    }
  };

  const options = kind === 'help'
    ? myResponse === 'accepted'
      ? [{ r: 'declined' as const, label: 'I can no longer help', variant: 'secondary' as const }]
      : [{ r: 'accepted' as const, label: 'I can help', variant: 'primary' as const }, { r: 'declined' as const, label: 'Not this time', variant: 'secondary' as const }]
    : [
        { r: 'accepted' as const, label: 'Going', variant: myResponse === 'accepted' ? 'primary' as const : 'secondary' as const },
        { r: 'tentative' as const, label: 'Maybe', variant: myResponse === 'tentative' ? 'primary' as const : 'secondary' as const },
        { r: 'declined' as const, label: 'Can’t', variant: myResponse === 'declined' ? 'primary' as const : 'secondary' as const },
      ];

  return (
    <Stack gap={space.sm}>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {options.map((o) => (
          <Button
            key={o.r}
            label={o.label}
            variant={o.variant}
            loading={pending === o.r}
            disabled={!!pending && pending !== o.r}
            onPress={() => send(o.r)}
            style={{ flexGrow: 1 }}
            accessibilityLabel={myResponse === o.r ? `${o.label}, your current reply` : o.label}
          />
        ))}
      </View>
      {message ? <Banner tone={message.tone} text={message.text} /> : null}
    </Stack>
  );
}

export function RequestCard({ item, tz, familyId, fromName }: { item: CalendarItem; tz: string; familyId: string; fromName: string }) {
  const cat = categoryOf(item.category);
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => router.push(`/task/${item.id}`)} style={{ gap: 4 }}>
        <Caption>{item.kind === 'help' ? cat.label : 'Family event'} · from {fromName}</Caption>
        <Strong style={{ fontSize: 19 }}>{item.title}</Strong>
        <Caption>{formatWhen(item, tz)}{item.location ? ` · ${item.location}` : ''}</Caption>
      </Pressable>
      <RespondButtons familyId={familyId} taskId={item.id} kind={item.kind} myResponse={item.my_response} />
    </View>
  );
}
