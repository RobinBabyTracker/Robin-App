import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Avatar, Banner, Button, Caption, Card, ChoiceChip, ErrorState, Loading, Pill, Screen, Section, Stack, Strong, TextField,
} from '@/ui/components';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { keys, useInvitations, useMembers, useNames } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/time';
import type { Invitation, MemberWithProfile, Role } from '@/lib/types';
import { space } from '@/ui/theme';

const ROLE: Record<Role, string> = { owner: 'Owner', parent: 'Parent', helper: 'Helper' };

/** Asks before anything that's hard to undo, so a mis-tap never removes someone. */
function confirm(title: string, message: string, action: string, onYes: () => void) {
  Alert.alert(title, message, [{ text: 'Not now', style: 'cancel' }, { text: action, style: 'destructive', onPress: onYes }]);
}

function inviteState(i: Invitation) {
  if (i.revoked_at) return 'Cancelled';
  if (i.accepted_at) return 'Joined';
  if (i.declined_at) return 'Declined';
  if (new Date(i.expires_at) <= new Date()) return 'Expired';
  return 'Waiting';
}

export default function FamilySettings() {
  const { userId, timezone } = useAuth();
  const { current, familyId, isParent, isOwner, refetch } = useFamily();
  const qc = useQueryClient();
  const members = useMembers(familyId);
  const invites = useInvitations(familyId, isParent);
  const name = useNames(familyId);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setError(null); setNotice(null); setBusy(key);
    try {
      await fn();
      setNotice(ok);
      qc.invalidateQueries({ queryKey: keys.members(familyId) });
      qc.invalidateQueries({ queryKey: keys.invitations(familyId) });
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const canRemove = (m: MemberWithProfile) =>
    m.user_id !== userId && m.role !== 'owner' && (isOwner || (isParent && m.role === 'helper'));

  if (members.isLoading) return <Screen><Loading /></Screen>;
  if (members.error) return <Screen><ErrorState error={members.error} onRetry={() => members.refetch()} /></Screen>;

  const pending = (invites.data ?? []).filter((i) => inviteState(i) === 'Waiting');
  const past = (invites.data ?? []).filter((i) => inviteState(i) !== 'Waiting').slice(0, 10);

  return (
    <Screen>
      <Stack gap={space.md}>
        {error ? <Banner tone="error" text={error} /> : null}
        {notice ? <Banner tone="success" text={notice} /> : null}

        {isParent ? (
          <Card>
            <Stack gap={space.md}>
              <TextField label="Family name" value={familyName ?? current?.name ?? ''} onChangeText={setFamilyName} maxLength={60} />
              <Button label="Save name" variant="secondary" small disabled={familyName === null || !familyName.trim()} loading={busy === 'rename'}
                onPress={() => run('rename', async () => { await rpc('rename_family', { p_family: familyId, p_name: familyName!.trim() }); await refetch(); }, 'Family name saved.')} />
            </Stack>
          </Card>
        ) : null}

        <Section title={`Members · ${members.data?.length ?? 0}`} action={isParent ? <Button label="Invite" icon="plus" small variant="text" onPress={() => router.push('/settings/invite')} /> : undefined}>
          <Stack gap={space.sm}>
            {(members.data ?? []).map((m) => {
              const expanded = open === m.user_id;
              const manageable = isOwner && m.user_id !== userId || canRemove(m);
              return (
                <Card key={m.user_id} style={{ padding: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <Avatar name={m.profile?.display_name} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Strong>{m.user_id === userId ? `${m.profile?.display_name ?? 'You'} (you)` : m.profile?.display_name ?? 'Someone'}</Strong>
                      <Caption>{[m.relation_label, `joined ${timeAgo(m.joined_at, timezone).toLowerCase()}`].filter(Boolean).join(' · ')}</Caption>
                    </View>
                    <Pill tone={m.role === 'helper' ? 'pink' : 'olive'} label={ROLE[m.role]} />
                  </View>
                  {manageable ? (
                    <Button
                      label={expanded ? 'Done' : 'Manage'}
                      accessibilityLabel={`${expanded ? 'Done managing' : 'Manage'} ${m.profile?.display_name ?? 'member'}`}
                      accessibilityState={{ expanded }}
                      variant="text" small onPress={() => setOpen(expanded ? null : m.user_id)} style={{ alignSelf: 'flex-end' }} />
                  ) : null}
                  {expanded ? (
                    <Stack gap={space.sm}>
                      {isOwner ? (
                        <>
                          <Caption>Role</Caption>
                          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                            {(['owner', 'parent', 'helper'] as Role[]).map((r) => (
                              <ChoiceChip single key={r} label={ROLE[r]} selected={m.role === r}
                                onPress={() => {
                                  if (m.role === r) return;
                                  const who = m.profile?.display_name ?? 'They';
                                  const change = () => run(`role:${m.user_id}`, () => rpc('set_member_role', { p_family: familyId, p_user: m.user_id, p_role: r }), `${who} is now ${ROLE[r].toLowerCase()}.`);
                                  confirm(`Make ${who} ${ROLE[r].toLowerCase()}?`,
                                    r === 'owner' ? 'Owners can change everyone’s role and remove anyone except other owners.'
                                      : r === 'parent' ? 'Parents can ask for help, invite people and remove helpers.'
                                      : 'Helpers can reply to requests, chat and see shared memories.',
                                    'Change role', change);
                                }} />
                            ))}
                          </View>
                          <Caption>Parents can ask for help, invite and remove helpers. Owners can also change roles.</Caption>
                        </>
                      ) : null}
                      {canRemove(m) ? (
                        <Button label={`Remove ${m.profile?.display_name ?? 'member'}`} variant="danger" small loading={busy === `rm:${m.user_id}`}
                          onPress={() => confirm(`Remove ${m.profile?.display_name ?? 'this person'}?`, 'They’ll lose access to everything in this family straight away. You can invite them again later.', 'Remove',
                            () => run(`rm:${m.user_id}`, () => rpc('remove_member', { p_family: familyId, p_user: m.user_id }), 'Removed. They can no longer see anything in this family.').then(() => setOpen(null)))} />
                      ) : null}
                    </Stack>
                  ) : null}
                </Card>
              );
            })}
          </Stack>
        </Section>

        {isParent ? (
          <Section title="Invitations">
            {invites.isLoading ? <Loading /> : invites.error ? <ErrorState error={invites.error} onRetry={() => invites.refetch()} /> : (
              <Stack gap={space.sm}>
                {!pending.length ? <Caption>No open invitations.</Caption> : null}
                {pending.map((i) => (
                  <Card key={i.id} style={{ padding: space.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                      <View style={{ flex: 1 }}>
                        <Strong>{i.note || `${ROLE[i.role]} invitation`}</Strong>
                        <Caption>From {name(i.invited_by, 'a parent')} · expires {new Date(i.expires_at).toLocaleDateString()}</Caption>
                      </View>
                      <Button label="Cancel" accessibilityLabel={`Cancel invitation${i.note ? ` for ${i.note}` : ''}`} small variant="danger" loading={busy === `rv:${i.id}`}
                        onPress={() => confirm('Cancel this invitation?', 'The code will stop working. You can always make a new one.', 'Cancel invitation',
                          () => run(`rv:${i.id}`, () => rpc('revoke_invitation', { p_invitation: i.id }), 'Invitation cancelled. That code no longer works.'))} />
                    </View>
                  </Card>
                ))}
                {past.length ? <Caption>Recent: {past.map((i) => `${i.note || ROLE[i.role]} (${inviteState(i).toLowerCase()}${i.accepted_by ? ` by ${name(i.accepted_by)}` : ''})`).join(', ')}</Caption> : null}
              </Stack>
            )}
          </Section>
        ) : null}

        <Section title="Leave">
          {!confirmLeave ? (
            <Button label="Leave this family" icon="logout" variant="danger" onPress={() => setConfirmLeave(true)} />
          ) : (
            <Card>
              <Stack gap={space.md}>
                <Strong>Leave {current?.name}?</Strong>
                <Caption>You'll lose access to its calendar, chats and memories. Anything you'd agreed to help with will be handed back.{(members.data?.length ?? 0) === 1 ? ' You’re the only member, so the family and everything in it will be deleted.' : ''}</Caption>
                <Button label="Yes, leave" variant="danger" loading={busy === 'leave'}
                  onPress={async () => { const ok = await run('leave', () => rpc('leave_family', { p_family: familyId }), 'You left the family.'); if (ok) { await refetch(); router.dismissTo('/'); } }} />
                <Button label="Stay" variant="text" onPress={() => setConfirmLeave(false)} />
              </Stack>
            </Card>
          )}
        </Section>
      </Stack>
    </Screen>
  );
}
