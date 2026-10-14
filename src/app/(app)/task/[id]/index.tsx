import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import {
  Avatar, Banner, Body, Button, Caption, Card, EmptyState, ErrorState, Heading, Loading, Overline, Screen, Stack, Strong, TextField, Title, Voice,
} from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { RespondButtons, StatusPill, categoryOf } from '@/components/tasks';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useInvalidateTasks, useMembers, useTask } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatTime, formatWhen, otherZoneHint, relativeDayLabel, zonedParts } from '@/lib/time';
import { space } from '@/ui/theme';

export default function TaskDetail() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { userId, timezone } = useAuth();
  const { familyId } = useFamily();
  const q = useTask(id);
  const members = useMembers(familyId);
  const invalidate = useInvalidateTasks();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(created === 'send' ? 'Sent! We’ll let you know as people reply.' : created === 'draft' ? 'Saved as a draft. Only you can see it.' : null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');

  const nameOf = (uid: string | null) => {
    if (!uid) return 'A former member';
    if (uid === userId) return 'You';
    return members.data?.find((m) => m.user_id === uid)?.profile?.display_name ?? 'Someone';
  };

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  if (!q.data) {
    return (
      <Screen>
        <EmptyState title="This isn't available" body="It may have been removed, or it wasn't shared with you." action={{ label: 'Back', onPress: () => router.back() }} />
      </Screen>
    );
  }

  const { task, invitees, responses } = q.data;
  const isOrganiser = task.created_by === userId;
  const mine = responses.find((r) => r.user_id === userId)?.response ?? null;
  const invited = invitees.includes(userId ?? '');
  const accepted = responses.filter((r) => r.response === 'accepted');
  const tentative = responses.filter((r) => r.response === 'tentative');
  const declined = responses.filter((r) => r.response === 'declined');
  const noReply = invitees.filter((u) => !responses.some((r) => r.user_id === u));
  const closed = task.status === 'completed' || task.status === 'cancelled';
  const past = new Date(task.ends_at).getTime() < Date.now();
  const filledByOthers = task.kind === 'help' && task.status === 'confirmed' && mine !== 'accepted';
  const cat = categoryOf(task.category);
  const hint = otherZoneHint(task, timezone);
  const statusItem = {
    kind: task.kind, status: task.status, accepted_count: accepted.length, helpers_needed: task.helpers_needed,
    tentative_count: tentative.length, my_role: isOrganiser ? 'organiser' as const : mine === 'accepted' ? 'helper' as const : 'invited' as const,
  };

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      await fn();
      setNotice(success);
      invalidate(familyId, task.id);
    } catch (e) {
      setError(friendlyError(e));
      q.refetch();
    } finally {
      setBusy(null);
    }
  };

  const messagePerson = async (uid: string) => {
    setBusy(`msg:${uid}`);
    try {
      const conv = await rpc<string>('create_conversation', { p_family: familyId, p_members: [uid] });
      router.push(`/chat/${conv}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const respondByLabel = task.respond_by
    ? (() => { const p = zonedParts(task.respond_by, timezone); return `${relativeDayLabel({ year: p.year, month: p.month, day: p.day }, timezone)}, ${formatTime(task.respond_by, timezone)}`; })()
    : null;

  return (
    <Screen>
      <RouterStack.Screen options={{ title: task.kind === 'help' ? 'Request' : 'Event' }} />
      <Stack gap={space.lg}>
        {notice ? <Banner tone="success" text={notice} /> : null}
        {error ? <Banner tone="error" text={error} /> : null}

        <Stack gap={space.sm}>
          <Caption>{task.kind === 'help' ? `${cat.label} · asked by ${nameOf(task.created_by)}` : `Family event · from ${nameOf(task.created_by)}`}</Caption>
          <Title style={task.status === 'cancelled' ? { textDecorationLine: 'line-through' } : undefined}>{task.title}</Title>
          <StatusPill item={statusItem} helperName={accepted[0] ? nameOf(accepted[0].user_id) : null} />
        </Stack>

        {task.status === 'cancelled' ? (
          <Banner tone="info" text={`This was cancelled${task.cancelled_reason ? `: ${task.cancelled_reason}` : '.'}`} />
        ) : null}

        <Card>
          <Stack gap={space.md}>
            <Row icon="calendar" text={formatWhen(task, timezone)} sub={hint ?? undefined} />
            {task.location ? <Row icon="pin" text={task.location} /> : null}
            {respondByLabel && !closed ? <Row icon="clock" text={`Reply by ${respondByLabel}`} /> : null}
            {task.kind === 'help' ? <Row icon="people" text={task.helpers_needed === 1 ? 'One helper needed' : `${task.helpers_needed} helpers needed`} /> : null}
          </Stack>
        </Card>

        {task.description || task.notes || task.links.length ? (
          <Card>
            <Stack gap={space.md}>
              {task.description ? <Body>{task.description}</Body> : null}
              {task.notes ? <Stack gap={4}><Overline>Notes</Overline><Body>{task.notes}</Body></Stack> : null}
              {task.links.map((l) => (
                <Button key={l} label={l.replace(/^https?:\/\//, '').slice(0, 40)} icon="link" variant="text" onPress={() => Linking.openURL(l).catch(() => setError('That link couldn’t be opened.'))} style={{ alignSelf: 'flex-start' }} />
              ))}
            </Stack>
          </Card>
        ) : null}

        {/* Replying */}
        {invited && !isOrganiser && !closed && !past ? (
          filledByOthers ? (
            <Banner tone="info" text={`${accepted.map((a) => nameOf(a.user_id)).join(' and ')} ${accepted.length === 1 ? 'has' : 'have'} this covered. Thank you for being there!`} />
          ) : (
            <Card>
              <Stack gap={space.md}>
                <Heading>{task.kind === 'help' ? (mine === 'accepted' ? 'You’re helping with this' : 'Can you help?') : 'Can you come?'}</Heading>
                {mine === 'declined' && task.kind === 'help' ? <Voice>You said not this time. If plans change, you can still offer.</Voice> : null}
                <RespondButtons familyId={familyId} taskId={task.id} kind={task.kind} myResponse={mine} onDone={() => q.refetch()} />
              </Stack>
            </Card>
          )
        ) : null}

        {/* Who's in */}
        {task.status !== 'draft' ? (
          <Card>
            <Stack gap={space.md}>
              <Heading>{task.kind === 'help' ? 'Helpers' : 'Who’s coming'}</Heading>
              <PeopleList title={task.kind === 'help' ? 'Helping' : 'Going'} ids={accepted.map((r) => r.user_id)} nameOf={nameOf} onMessage={messagePerson} me={userId} busy={busy} />
              {task.kind === 'event' ? <PeopleList title="Maybe" ids={tentative.map((r) => r.user_id)} nameOf={nameOf} /> : null}
              {isOrganiser && declined.length ? <PeopleList title="Can't make it (only you can see this)" ids={declined.map((r) => r.user_id)} nameOf={nameOf} /> : null}
              {(isOrganiser || task.kind === 'event') && noReply.length && !closed ? <PeopleList title="Not replied yet" ids={noReply} nameOf={nameOf} /> : null}
              {!accepted.length && !tentative.length ? <Caption>No one has said yes yet.</Caption> : null}
            </Stack>
          </Card>
        ) : null}

        {!isOrganiser && task.created_by ? (
          <Button label={`Message ${nameOf(task.created_by)}`} icon="chat" variant="secondary" loading={busy === `msg:${task.created_by}`} onPress={() => messagePerson(task.created_by!)} />
        ) : null}

        {/* Organiser actions */}
        {isOrganiser && !closed ? (
          <Stack gap={space.sm}>
            {task.status === 'draft' ? (
              <Button label="Send it now" icon="send" loading={busy === 'send'} onPress={() => act('send', () => rpc('send_task', { p_task: task.id }), 'Sent! We’ll let you know as people reply.')} />
            ) : null}
            <Button label="Edit" icon="pencil" variant="secondary" onPress={() => router.push(`/task/${task.id}/edit`)} />
            {(task.status === 'confirmed' || (task.kind === 'event' && task.status === 'open')) ? (
              <Button label="Mark as done" icon="checkCircle" variant="secondary" loading={busy === 'done'} onPress={() => act('done', () => rpc('complete_task', { p_task: task.id }), 'Marked as done. Thank you, everyone!')} />
            ) : null}
            {!confirmCancel ? (
              <Button label={task.status === 'draft' ? 'Delete draft' : 'Cancel this'} icon="close" variant="danger" onPress={() => setConfirmCancel(true)} />
            ) : (
              <Card>
                <Stack gap={space.md}>
                  <Strong>{task.status === 'draft' ? 'Delete this draft?' : 'Cancel this for everyone?'}</Strong>
                  {task.status !== 'draft' ? <Caption>Everyone who was asked will be told it's cancelled.</Caption> : null}
                  {task.status !== 'draft' ? <TextField label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={300} /> : null}
                  <Button label={task.status === 'draft' ? 'Delete draft' : 'Yes, cancel it'} variant="danger" loading={busy === 'cancel'}
                    onPress={() => act('cancel', () => rpc('cancel_task', { p_task: task.id, p_reason: reason.trim() || null }), 'Cancelled. Everyone involved has been told.').then(() => setConfirmCancel(false))} />
                  <Button label="Keep it" variant="text" onPress={() => setConfirmCancel(false)} />
                </Stack>
              </Card>
            )}
          </Stack>
        ) : null}

        {task.status !== 'draft' ? (
          <Button label="Add photos from this" icon="image" variant="text" onPress={() => router.push({ pathname: '/memory/new', params: { task: task.id } })} />
        ) : null}
      </Stack>
    </Screen>
  );
}

function Row({ icon, text, sub }: { icon: 'calendar' | 'pin' | 'clock' | 'people'; text: string; sub?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <Icon name={icon} size={20} />
      <View style={{ flex: 1 }}>
        <Body>{text}</Body>
        {sub ? <Caption>{sub}</Caption> : null}
      </View>
    </View>
  );
}

function PeopleList({ title, ids, nameOf, onMessage, me, busy }: { title: string; ids: string[]; nameOf: (u: string | null) => string; onMessage?: (u: string) => void; me?: string | null; busy?: string | null }) {
  if (!ids.length) return null;
  return (
    <Stack gap={space.sm}>
      <Overline>{title}</Overline>
      {ids.map((u) => (
        <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar name={nameOf(u)} size={36} />
          <Strong style={{ flex: 1 }}>{nameOf(u)}</Strong>
          {onMessage && u !== me ? <Button label="Message" accessibilityLabel={`Message ${nameOf(u)}`} small variant="text" loading={busy === `msg:${u}`} onPress={() => onMessage(u)} /> : null}
        </View>
      ))}
    </Stack>
  );
}

