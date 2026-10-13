import { useState } from 'react';
import { Share, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Body, Button, Caption, Card, ChoiceChip, EmptyState, Heading, Screen, Stack, Strong, TextField, Voice } from '@/ui/components';
import { useFamily } from '@/state/family';
import { keys } from '@/state/queries';
import { rpc } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { colors, radius, space } from '@/ui/theme';

const EXPIRY = [{ hours: 24, label: '1 day' }, { hours: 72, label: '3 days' }, { hours: 168, label: '1 week' }];

export default function Invite() {
  const { familyId, current, isParent } = useFamily();
  const qc = useQueryClient();
  const [role, setRole] = useState<'helper' | 'parent'>('helper');
  const [hours, setHours] = useState(72);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);

  if (!isParent) return <Screen><EmptyState title="Only parents can invite people" body="Ask a parent in your family to send an invitation." /></Screen>;

  const create = async () => {
    setError(null); setBusy(true);
    try {
      const rows = await rpc<{ invitation_id: string; token: string; expires_at: string }[]>('create_invitation', {
        p_family: familyId, p_role: role, p_expires_in_hours: hours, p_note: note.trim() || null,
      });
      setLink({ url: Linking.createURL(`invite/${rows[0].token}`), expires: rows[0].expires_at });
      qc.invalidateQueries({ queryKey: keys.invitations(familyId) });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      await Share.share({ message: `Join ${current?.name ?? 'our family'} on Robin: ${link.url}\n\nThis link works once and expires on ${new Date(link.expires).toLocaleDateString()}.` });
    } catch (e) {
      setError(friendlyError(e, 'Sharing didn’t work. You can copy the link instead.'));
    }
  };

  if (link) {
    return (
      <Screen>
        <Stack gap={space.lg}>
          <Banner tone="success" text="Your invitation link is ready." />
          <Card>
            <Stack gap={space.md}>
              <Heading>Send it to one person</Heading>
              <Voice>The link works once, for one person, until {new Date(link.expires).toLocaleString()}. Treat it like a key: send it straight to them.</Voice>
              <View style={{ padding: space.md, borderRadius: radius.sm, backgroundColor: colors.cream }}>
                <Body selectable>{link.url}</Body>
              </View>
              <Caption>We only show this link once. If it's lost, cancel it from Family members and make a new one.</Caption>
            </Stack>
          </Card>
          <Button label="Share link" icon="share" onPress={share} />
          <Button label="Invite someone else" variant="secondary" onPress={() => { setLink(null); setNote(''); }} />
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
              <ChoiceChip label="Helper: replies to requests, chats, sees memories" selected={role === 'helper'} onPress={() => setRole('helper')} />
              <ChoiceChip label="Parent: can also ask for help and invite" selected={role === 'parent'} onPress={() => setRole('parent')} />
            </View>
            <Strong>Link expires after</Strong>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {EXPIRY.map((e) => <ChoiceChip key={e.hours} label={e.label} selected={hours === e.hours} onPress={() => setHours(e.hours)} />)}
            </View>
            <TextField label="Who's it for? (optional, just for you)" value={note} onChangeText={setNote} maxLength={80} placeholder="Nana" />
          </Stack>
        </Card>
        <Button label="Create invitation link" loading={busy} onPress={create} />
      </Stack>
    </Screen>
  );
}
