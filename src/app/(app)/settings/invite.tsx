import { useState } from 'react';
import { AccessibilityInfo, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Caption, Card, ChoiceChip, EmptyState, Heading, Robin, Screen, Stack, Strong, TextField, Voice } from '@/ui/components';
import { useFamily } from '@/state/family';
import { keys } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatInviteCode } from '@/lib/forms';
import { colors, fonts, radius, space } from '@/ui/theme';

const EXPIRY = [{ hours: 24, label: '1 day' }, { hours: 72, label: '3 days' }, { hours: 168, label: '1 week' }];

export default function Invite() {
  const { familyId, current, isParent } = useFamily();
  const qc = useQueryClient();
  const [role, setRole] = useState<'helper' | 'parent'>('helper');
  const [hours, setHours] = useState(72);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isParent) return <Screen><EmptyState title="Only parents can invite people" body="Ask a parent in your family to send an invitation." /></Screen>;

  const create = async () => {
    setError(null); setBusy(true);
    try {
      const rows = await rpc<{ invitation_id: string; token: string; expires_at: string }[]>('create_invitation', {
        p_family: familyId, p_role: role, p_expires_in_hours: hours, p_note: note.trim() || null,
      });
      setInvite({ code: formatInviteCode(rows[0].token), expires: rows[0].expires_at });
      setCopied(false);
      qc.invalidateQueries({ queryKey: keys.invitations(familyId) });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const expiresOn = invite ? new Date(invite.expires).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '';

  const share = async () => {
    if (!invite) return;
    try {
      await Share.share({
        message:
          `Join ${current?.name ?? 'our family'} on Robin!\n\n` +
          `Open the Robin app, tap “I have an invite code” and enter:\n\n${invite.code}\n\n` +
          `The code works once and runs out on ${expiresOn}.`,
      });
    } catch (e) {
      setError(friendlyError(e, 'Sharing didn’t work. You can copy the code instead.'));
    }
  };

  const copy = async () => {
    if (!invite) return;
    await Clipboard.setStringAsync(invite.code);
    setCopied(true);
    AccessibilityInfo.announceForAccessibility('Code copied');
  };

  if (invite) {
    return (
      <Screen>
        <Stack gap={space.lg}>
          {error ? <Banner tone="error" text={error} /> : null}
          <Card>
            <Stack gap={space.md} style={{ alignItems: 'center' }}>
              <Robin size={80} />
              <Heading style={{ textAlign: 'center' }}>Here’s their invite code</Heading>
              <View
                accessible
                accessibilityLabel={`Invite code ${invite.code.split('').join(' ')}`}
                style={{ paddingVertical: space.lg, paddingHorizontal: space.xl, borderRadius: radius.md, backgroundColor: colors.cream, alignSelf: 'stretch', alignItems: 'center' }}
              >
                <Text selectable maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.bold, fontSize: 34, letterSpacing: 4, color: colors.text }}>{invite.code}</Text>
              </View>
              <Voice style={{ textAlign: 'center' }}>
                They open Robin, tap “I have an invite code” and type this in. It works once, until {expiresOn}.
              </Voice>
            </Stack>
          </Card>
          <Button label="Share code" icon="share" onPress={share} />
          <Button label={copied ? 'Copied' : 'Copy code'} icon={copied ? 'check' : 'link'} variant="secondary" onPress={copy} />
          <Caption style={{ textAlign: 'center' }}>We only show this code once. If it’s lost, cancel it from Family members and make a new one.</Caption>
          <Button label="Invite someone else" variant="text" onPress={() => { setInvite(null); setNote(''); }} />
        </Stack>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack gap={space.lg}>
        {error ? <Banner tone="error" text={error} /> : null}
        <Voice>Invite someone you trust to {current?.name}. They'll see what's shared with them, and nothing is ever public.</Voice>
        <Card>
          <Stack gap={space.lg}>
            <Strong>They'll join as</Strong>
            <View style={{ gap: space.sm }}>
              <ChoiceChip single label="Helper: replies to requests, chats, sees memories" selected={role === 'helper'} onPress={() => setRole('helper')} />
              <ChoiceChip single label="Parent: can also ask for help and invite" selected={role === 'parent'} onPress={() => setRole('parent')} />
            </View>
            <Strong>Code runs out after</Strong>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {EXPIRY.map((e) => <ChoiceChip single key={e.hours} label={e.label} selected={hours === e.hours} onPress={() => setHours(e.hours)} />)}
            </View>
            <TextField label="Who's it for? (optional, just for you)" value={note} onChangeText={setNote} maxLength={80} placeholder="Nana" />
          </Stack>
        </Card>
        <Button label="Create invite code" loading={busy} onPress={create} />
      </Stack>
    </Screen>
  );
}
