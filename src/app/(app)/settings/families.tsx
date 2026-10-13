import { router } from 'expo-router';
import { Button, Card, Heading, ListRow, Pill, Screen, Section, Stack } from '@/ui/components';
import { CreateFamilyForm } from '@/components/CreateFamilyForm';
import { useFamily } from '@/state/family';
import { Icon } from '@/ui/Icon';
import { space } from '@/ui/theme';

export default function Families() {
  const { families, familyId, select } = useFamily();
  return (
    <Screen>
      <Stack gap={space.md}>
        <Card style={{ padding: 0 }}>
          {families.map((f, i) => (
            <ListRow
              key={f.id}
              title={f.name}
              subtitle={f.role === 'helper' ? 'Helper' : f.role === 'owner' ? 'Owner' : 'Parent'}
              left={<Icon name="home" />}
              right={f.id === familyId ? <Pill tone="olive" icon="check" label="Current" /> : undefined}
              chevron={f.id !== familyId}
              onPress={f.id === familyId ? undefined : () => { select(f.id); router.dismissTo('/'); }}
              accessibilityLabel={f.id === familyId ? `${f.name}, current family` : `Switch to ${f.name}`}
              last={i === families.length - 1}
            />
          ))}
        </Card>
        <Section title="Join another family">
          <Button label="I have an invite link" variant="secondary" onPress={() => router.push('/settings/join')} />
        </Section>
        <Section title="Start a new family">
          <Card>
            <Stack gap={space.md}>
              <Heading>New family group</Heading>
              <CreateFamilyForm onCreated={() => router.dismissTo('/')} />
            </Stack>
          </Card>
        </Section>
      </Stack>
    </Screen>
  );
}
