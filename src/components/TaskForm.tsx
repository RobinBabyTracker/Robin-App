import { useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Banner, Body, Button, Caption, Card, ChoiceChip, Heading, IconButton, Segmented, Stack, Strong, TextField, ToggleRow, RobinNote, FieldError } from '@/ui/components';
import { DateTimeField } from './DateTimeField';
import { CATEGORIES } from './tasks';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useMembers } from '@/state/queries';
import { validateTask, type FieldErrors, type TaskCategory, type TaskDraft, type TaskKind } from '@/lib/forms';
import { addDays, allDayRange, parseDateKey, todayIn, zonedParts, zonedToUtc, type LocalDateTime } from '@/lib/time';
import type { Task } from '@/lib/types';
import { colors, space } from '@/ui/theme';

export type TaskPayload = Record<string, unknown>;

type Props = {
  initial?: { task: Task; invitees: string[] };
  presetDate?: string;
  submitting: 'send' | 'draft' | null;
  serverError: string | null;
  onSubmit: (payload: TaskPayload, mode: 'send' | 'draft') => void;
};

const plusHours = (v: LocalDateTime, h: number): LocalDateTime => {
  const d = new Date(Date.UTC(v.year, v.month - 1, v.day, v.hour + h, v.minute));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
};

export function TaskForm({ initial, presetDate, submitting, serverError, onSubmit }: Props) {
  const { timezone, userId } = useAuth();
  const { familyId } = useFamily();
  const members = useMembers(familyId);
  const clientId = useRef(Crypto.randomUUID()).current;
  const editing = !!initial;
  const t = initial?.task;

  const defaults = useMemo(() => {
    if (t) {
      const tz = t.all_day ? t.timezone : timezone;
      const s = zonedParts(t.starts_at, tz);
      const e = zonedParts(t.ends_at, tz);
      const r = t.respond_by ? zonedParts(t.respond_by, timezone) : null;
      return {
        start: { year: s.year, month: s.month, day: s.day, hour: s.hour, minute: s.minute },
        end: { year: e.year, month: e.month, day: e.day, hour: e.hour, minute: e.minute },
        respondBy: r ? { year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute } : null,
      };
    }
    const base = presetDate ? parseDateKey(presetDate) : addDays(todayIn(timezone), 1);
    const start = { ...base, hour: 9, minute: 0 };
    return { start, end: plusHours(start, 2), respondBy: null as LocalDateTime | null };
  }, [t, timezone, presetDate]);

  const [kind, setKind] = useState<TaskKind>(t?.kind ?? 'help');
  const [category, setCategory] = useState<TaskCategory>(t?.category ?? 'childcare');
  const [title, setTitle] = useState(t?.title ?? '');
  const [description, setDescription] = useState(t?.description ?? '');
  const [location, setLocation] = useState(t?.location ?? '');
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [linksText, setLinksText] = useState((t?.links ?? []).join('\n'));
  const [allDay, setAllDay] = useState(t?.all_day ?? false);
  const [start, setStart] = useState<LocalDateTime>(defaults.start);
  const [end, setEnd] = useState<LocalDateTime>(defaults.end);
  const [useRespondBy, setUseRespondBy] = useState(!!defaults.respondBy);
  const [respondBy, setRespondBy] = useState<LocalDateTime>(defaults.respondBy ?? plusHours(defaults.start, -12));
  const [helpers, setHelpers] = useState(t?.helpers_needed ?? 1);
  const [everyone, setEveryone] = useState(!initial);
  const [chosen, setChosen] = useState<string[]>(initial?.invitees ?? []);
  const [touched, setTouched] = useState(false);

  const others = (members.data ?? []).filter((m) => m.user_id !== userId);
  const lockedInvitees = new Set(initial?.invitees ?? []);

  const tzForDates = allDay ? (t?.all_day ? t.timezone : timezone) : timezone;
  const toDates = () => {
    if (allDay) {
      const endDate = { year: end.year, month: end.month, day: end.day };
      const r = allDayRange(start, endDate, tzForDates);
      return { startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) };
    }
    return { startsAt: zonedToUtc(start, timezone), endsAt: zonedToUtc(end, timezone) };
  };

  const links = linksText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const draft = (): TaskDraft => {
    const { startsAt, endsAt } = toDates();
    return {
      kind, category, title, description, location, notes, links, allDay, startsAt, endsAt,
      respondBy: useRespondBy ? zonedToUtc(respondBy, timezone) : null,
      helpersNeeded: helpers, invitees: everyone ? null : chosen,
    };
  };

  const errorsFor = (mode: 'send' | 'draft'): FieldErrors =>
    validateTask(draft(), new Date(), { sending: mode === 'send' && t?.status !== 'completed', editing });
  const errors = touched ? errorsFor('send') : {};

  const submit = (mode: 'send' | 'draft') => {
    setTouched(true);
    const errs = errorsFor(mode);
    const n = Object.keys(errs).length;
    if (n) {
      // The summary banner is at the top, out of view: say it out loud too.
      AccessibilityInfo.announceForAccessibility(`${n === 1 ? 'One thing needs' : `${n} things need`} another look: ${Object.values(errs).join('. ')}`);
      return;
    }
    const d = draft();
    onSubmit({
      kind, category, title: title.trim(), description, location, notes, links,
      starts_at: d.startsAt.toISOString(), ends_at: d.endsAt.toISOString(), all_day: allDay, timezone: tzForDates,
      respond_by: d.respondBy ? d.respondBy.toISOString() : null,
      helpers_needed: kind === 'help' ? helpers : 1,
      invitees: everyone ? (editing ? undefined : null) : chosen,
      client_id: clientId,
    }, mode);
  };

  const errorCount = Object.keys(errors).length;
  const toggle = (id: string) => {
    if (lockedInvitees.has(id)) return;
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  const nobodyToAsk = !editing && !members.isLoading && others.length === 0;

  return (
    <Stack gap={space.lg}>
      {nobodyToAsk ? (
        <RobinNote
          pose="flying"
          text="It’s just you in the family so far. Invite someone first, then you can ask them once they’ve joined."
          action={{ label: 'Invite someone', icon: 'plus', onPress: () => router.push('/settings/invite') }}
        />
      ) : null}

      {!editing ? (
        <Segmented
          label="What would you like to do?"
          value={kind}
          onChange={(k) => { setKind(k); setCategory(k === 'event' ? 'family_event' : 'childcare'); }}
          options={[{ value: 'help', label: 'Ask for help' }, { value: 'event', label: 'Plan an event' }]}
        />
      ) : null}

      {serverError ? <Banner tone="error" text={serverError} /> : null}
      {errorCount ? <Banner tone="error" text={`${errorCount === 1 ? 'One thing needs' : `${errorCount} things need`} another look.`} /> : null}

      <Card>
        <Stack gap={space.lg}>
          <Heading>{kind === 'help' ? 'What do you need a hand with?' : 'What’s happening?'}</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Type">
            {CATEGORIES.filter((c) => (kind === 'event' ? ['family_event', 'appointment', 'other'] : CATEGORIES.map((x) => x.value).filter((v) => v !== 'family_event')).includes(c.value)).map((c) => (
              <ChoiceChip single key={c.value} label={c.label} icon={c.icon} selected={category === c.value} onPress={() => setCategory(c.value)} />
            ))}
          </View>
          <TextField label="Title" value={title} onChangeText={setTitle} maxLength={120} placeholder={kind === 'help' ? 'School pick-up' : 'Poppy’s birthday picnic'} error={errors.title} />
          <TextField label="Details (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} error={errors.description} />
        </Stack>
      </Card>

      <Card>
        <Stack gap={space.lg}>
          <Heading>When</Heading>
          <ToggleRow label="All day" value={allDay} onValueChange={setAllDay} />
          <DateTimeField label="Starts" value={start} dateOnly={allDay} error={!!errors.time} onChange={(v) => {
            const shift = (Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute) - Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute)) / 3_600_000;
            setStart(v);
            setEnd(plusHours(end, shift)); // keep the same length when the start moves
          }} />
          <DateTimeField label="Ends" value={end} dateOnly={allDay} error={!!errors.time} onChange={setEnd} />
          {errors.time ? <FieldError text={errors.time} /> : null}
          <Caption>Times are in your time zone ({timezone.replace(/_/g, ' ')}).</Caption>
        </Stack>
      </Card>

      <Card>
        <Stack gap={space.lg}>
          <Heading>Who to ask</Heading>
          {editing ? <Caption>You can add people. Anyone already asked stays on the list.</Caption> : (
            <Segmented label="Who to ask" value={everyone ? 'all' : 'some'} onChange={(v) => setEveryone(v === 'all')} options={[{ value: 'all', label: 'Everyone' }, { value: 'some', label: 'Choose people' }]} />
          )}
          {!everyone ? (
            members.isLoading ? <Caption>Loading your family…</Caption> : others.length ? (
              <View style={{ gap: space.sm }}>
                {others.map((m) => {
                  const on = chosen.includes(m.user_id);
                  return (
                    <ChoiceChip
                      key={m.user_id}
                      label={`${m.profile?.display_name ?? 'Someone'}${m.relation_label ? ` (${m.relation_label})` : ''}${lockedInvitees.has(m.user_id) ? ' · asked' : ''}`}
                      selected={on}
                      onPress={() => toggle(m.user_id)}
                    />
                  );
                })}
              </View>
            ) : <Body>There’s no one else in your family yet. Invite someone first, using the button at the top.</Body>
          ) : <Caption>Everyone in your family except you will be asked{kind === 'help' ? '. The first to say yes gets it' : ''}.</Caption>}
          {errors.invitees ? <FieldError text={errors.invitees} /> : null}

          {kind === 'help' ? (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              // One control for screen readers: swipe up or down to change the number.
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Helpers needed"
              accessibilityValue={{ text: helpers === 1 ? 'One person' : `${helpers} people` }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'increment') setHelpers(Math.min(20, helpers + 1));
                if (e.nativeEvent.actionName === 'decrement') setHelpers(Math.max(1, helpers - 1));
              }}
            >
              <View style={{ flex: 1 }}>
                <Strong>Helpers needed</Strong>
                <Caption>{helpers === 1 ? 'One person, first to say yes.' : `The first ${helpers} to say yes.`}</Caption>
              </View>
              <IconButton icon="minus" label="One fewer helper" onPress={() => setHelpers(Math.max(1, helpers - 1))} disabled={helpers <= 1} />
              <Strong accessibilityRole="text">{String(helpers)}</Strong>
              <IconButton icon="plus" label="One more helper" onPress={() => setHelpers(Math.min(20, helpers + 1))} disabled={helpers >= 20} />
            </View>
          ) : null}

          <ToggleRow label="Ask for replies by a set time" hint="Optional. Helpful if you need to know early." value={useRespondBy} onValueChange={setUseRespondBy} />
          {useRespondBy ? <DateTimeField label="Reply by" value={respondBy} onChange={setRespondBy} error={!!errors.respondBy} /> : null}
          {errors.respondBy ? <FieldError text={errors.respondBy} /> : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={space.lg}>
          <Heading>Extra details</Heading>
          <TextField label="Location (optional)" value={location} onChangeText={setLocation} maxLength={200} error={errors.location} />
          <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} hint="Anything a helper should know." error={errors.notes} />
          <TextField label="Links (optional)" value={linksText} onChangeText={setLinksText} multiline autoCapitalize="none" keyboardType="url" hint="One per line, up to 5." error={errors.links} />
        </Stack>
      </Card>

      {editing ? (
        <Button label="Save changes" loading={submitting === 'send'} onPress={() => submit('send')} />
      ) : (
        <>
          <Button label={kind === 'help' ? 'Send request' : 'Send invitations'} loading={submitting === 'send'} disabled={submitting === 'draft'} onPress={() => submit('send')} />
          <Button label="Save as draft" variant="secondary" loading={submitting === 'draft'} disabled={submitting === 'send'} onPress={() => submit('draft')} />
        </>
      )}
    </Stack>
  );
}
