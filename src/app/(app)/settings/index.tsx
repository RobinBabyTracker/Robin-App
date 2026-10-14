import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Avatar, Button, Caption, Card, ListRow, Screen, Section, Stack } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { guide } from '@/lib/guide';
import { space } from '@/ui/theme';

const ROLE_LABEL = { owner: 'Owner', parent: 'Parent', helper: 'Helper' } as const;

export default function SettingsHome() {
  const { profile, timezone, signOut, userId } = useAuth();
  const { current, isParent, families } = useFamily();
  const [checklistHidden, setChecklistHidden] = useState(false);
  useFocusEffect(useCallback(() => { if (userId) setChecklistHidden(guide.checklistHidden(userId)); }, [userId]));

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Card style={{ padding: 0 }}>
          <ListRow
            title={profile?.display_name ?? 'Your profile'}
            subtitle={`Time zone: ${timezone.replace(/_/g, ' ')}`}
            left={<Avatar name={profile?.display_name} size={48} />}
            onPress={() => router.push('/settings/profile')}
            last
          />
        </Card>

        <Section title={current ? `${current.name} · you're ${ROLE_LABEL[current.role].toLowerCase()}` : 'Family'}>
          <Card style={{ padding: 0 }}>
            <ListRow title="Family members" subtitle={isParent ? 'Roles, removing people, invitations' : 'Who’s in your family'} left={<Icon name="people" />} onPress={() => router.push('/settings/family')} />
            {isParent ? <ListRow title="Invite someone" subtitle="Send a private, one-time link" left={<Icon name="plus" />} onPress={() => router.push('/settings/invite')} /> : null}
            <ListRow title="Your families" subtitle={families.length > 1 ? `${families.length} families · switch, create or join` : 'Create or join another family'} left={<Icon name="home" />} onPress={() => router.push('/settings/families')} last />
          </Card>
        </Section>

        <Section title="Help">
          <Card style={{ padding: 0 }}>
            <ListRow title="How Robin works" subtitle="Watch the welcome tour again" left={<Icon name="star" />} onPress={() => router.push('/tour')} last={!checklistHidden} />
            {checklistHidden && userId ? (
              <ListRow
                title="Show getting started"
                subtitle="Put the checklist back on Home"
                left={<Icon name="checkCircle" />}
                onPress={() => { guide.setChecklistHidden(userId, false); setChecklistHidden(false); router.navigate('/'); }}
                last
              />
            ) : null}
          </Card>
        </Section>

        <Section title="Preferences">
          <Card style={{ padding: 0 }}>
            <ListRow title="Notifications" subtitle="Choose what Robin tells you about" left={<Icon name="bell" />} onPress={() => router.push('/settings/notifications')} />
            <ListRow title="Privacy & account" subtitle="Your data, deleting your account" left={<Icon name="lock" />} onPress={() => router.push('/settings/account')} last />
          </Card>
        </Section>

        <Button label="Sign out" icon="logout" variant="secondary" onPress={signOut} style={{ marginTop: space.xl }} />
        <Caption style={{ textAlign: 'center' }}>Robin 0.1 · Made with care</Caption>
      </Stack>
    </Screen>
  );
}
