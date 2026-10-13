import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { AskForHelpButton } from '@/components/AskForHelpButton';
import { TaskRow } from '@/components/tasks';
import { Caption, ChoiceChip, EmptyState, ErrorState, IconButton, Loading, Overline, Screen, Segmented, Stack, Strong } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { useCalendar } from '@/state/queries';
import {
  addDays, addMonths, compareDates, dateKey, dayRangeUtc, formatDate, itemDateKeys, monthGrid, monthName,
  relativeDayLabel, startOfWeek, todayIn, weekdayName, weekdayOf, type LocalDate,
} from '@/lib/time';
import type { CalendarItem } from '@/lib/types';
import { colors, fonts, radius, space } from '@/ui/theme';

type View_ = 'week' | 'month';
type Kind = 'all' | 'help' | 'event';

export default function CalendarScreen() {
  const { timezone } = useAuth();
  const { familyId, isParent } = useFamily();
  const today = todayIn(timezone);
  const [mode, setMode] = useState<View_>('week');
  const [scope, setScope] = useState<'mine' | 'family'>('mine');
  const [kind, setKind] = useState<Kind>('all');
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<LocalDate>(today);
  const [monthCursor, setMonthCursor] = useState({ year: today.year, month: today.month });

  const weekStart = startOfWeek(selected);
  const days = mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : monthGrid(monthCursor.year, monthCursor.month);
  const range = useMemo(() => dayRangeUtc(days[0], days[days.length - 1], timezone), [dateKey(days[0]), dateKey(days[days.length - 1]), timezone]);
  const cal = useCalendar(familyId, range.from, range.to, scope);

  const visible = (cal.data ?? []).filter((i) =>
    i.status !== 'draft' || i.my_role === 'organiser').filter((i) =>
    (kind === 'all' || i.kind === kind) && (showCancelled || i.status !== 'cancelled'));

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of visible) for (const k of itemDateKeys(it, timezone)) m.set(k, [...(m.get(k) ?? []), it]);
    return m;
  }, [visible, timezone]);

  const selectedItems = byDay.get(dateKey(selected)) ?? [];
  const rangeLabel = mode === 'week'
    ? `${formatDate(days[0])} – ${formatDate(days[6])}`
    : `${monthName(monthCursor.month)} ${monthCursor.year}`;

  const step = (dir: -1 | 1) => {
    if (mode === 'week') setSelected(addDays(selected, dir * 7));
    else {
      const m = addMonths(monthCursor.year, monthCursor.month, dir);
      setMonthCursor(m);
      setSelected({ ...m, day: 1 });
    }
  };

  const goToday = () => { setSelected(today); setMonthCursor({ year: today.year, month: today.month }); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Calendar" />
      <Screen refreshControl={<RefreshControl refreshing={cal.isRefetching} onRefresh={() => cal.refetch()} />}>
        <Stack gap={space.md}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Segmented label="Whose plans to show" value={scope} onChange={setScope} options={[{ value: 'mine', label: 'Mine' }, { value: 'family', label: 'Whole family' }]} />
            </View>
            <View style={{ width: 150 }}>
              <Segmented label="Calendar view" value={mode} onChange={(m) => { setMode(m); setMonthCursor({ year: selected.year, month: selected.month }); }} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <ChoiceChip label="Requests" selected={kind === 'help'} onPress={() => setKind(kind === 'help' ? 'all' : 'help')} />
            <ChoiceChip label="Events" selected={kind === 'event'} onPress={() => setKind(kind === 'event' ? 'all' : 'event')} />
            <ChoiceChip label="Show cancelled" selected={showCancelled} onPress={() => setShowCancelled(!showCancelled)} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <IconButton icon="chevronLeft" label={mode === 'week' ? 'Previous week' : 'Previous month'} onPress={() => step(-1)} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${rangeLabel}. Go to today`} onPress={goToday} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Strong>{rangeLabel}</Strong>
            </Pressable>
            <IconButton icon="chevronRight" label={mode === 'week' ? 'Next week' : 'Next month'} onPress={() => step(1)} />
          </View>

          {mode === 'month' ? (
            <View style={{ flexDirection: 'row' }}>
              {[0, 1, 2, 3, 4, 5, 6].map((w) => (
                <Text key={w} style={{ flex: 1, textAlign: 'center', fontFamily: fonts.bold, fontSize: 12, color: colors.textSecondary }}>{weekdayName(w)}</Text>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {days.map((d) => {
              const count = byDay.get(dateKey(d))?.length ?? 0;
              const isSel = compareDates(d, selected) === 0;
              const isToday = compareDates(d, today) === 0;
              const outside = mode === 'month' && d.month !== monthCursor.month;
              return (
                <Pressable
                  key={dateKey(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                  accessibilityLabel={`${relativeDayLabel(d, timezone)}${count ? `, ${count} plan${count === 1 ? '' : 's'}` : ', nothing planned'}`}
                  onPress={() => setSelected(d)}
                  style={{ width: `${100 / 7}%`, padding: 2 }}
                >
                  <View style={{
                    minHeight: mode === 'week' ? 64 : 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2,
                    backgroundColor: isSel ? colors.primary : 'transparent', borderWidth: isToday && !isSel ? 1.5 : 0, borderColor: colors.text,
                  }}>
                    {mode === 'week' ? <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: isSel ? colors.onPrimary : colors.text }}>{weekdayName(weekdayOf(d))}</Text> : null}
                    <Text style={{ fontFamily: fonts.bold, fontSize: mode === 'week' ? 18 : 16, color: isSel ? colors.onPrimary : outside ? colors.textSecondary : colors.text }}>{d.day}</Text>
                    <View style={{ flexDirection: 'row', gap: 2, height: 6 }}>
                      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isSel ? colors.background : colors.primary }} />
                      ))}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {cal.isLoading ? <Loading /> : cal.error ? <ErrorState error={cal.error} onRetry={() => cal.refetch()} /> : (
            <Stack gap={space.sm}>
              <Overline>{relativeDayLabel(selected, timezone)}</Overline>
              {selectedItems.length ? (
                selectedItems.map((i) => <TaskRow key={i.id} item={i} tz={timezone} />)
              ) : (
                <Caption>Nothing planned{scope === 'mine' ? ' for you' : ''} on this day.</Caption>
              )}
              {mode === 'week' ? <LaterThisWeek days={days} selected={selected} byDay={byDay} tz={timezone} /> : null}
              {!visible.length ? (
                <EmptyState
                  pose="pecking"
                  title={scope === 'mine' ? 'Your calendar is clear' : 'Nothing planned for the family'}
                  body={isParent ? 'Tap Ask for help to plan something or ask for a hand.' : 'Requests and events you’re part of will appear here.'}
                />
              ) : null}
            </Stack>
          )}
        </Stack>
      </Screen>
      {isParent ? <AskForHelpButton date={dateKey(selected)} /> : null}
    </View>
  );
}

function LaterThisWeek({ days, selected, byDay, tz }: { days: LocalDate[]; selected: LocalDate; byDay: Map<string, CalendarItem[]>; tz: string }) {
  const later = days.filter((d) => compareDates(d, selected) > 0 && (byDay.get(dateKey(d))?.length ?? 0) > 0);
  if (!later.length) return null;
  const seen = new Set((byDay.get(dateKey(selected)) ?? []).map((i) => i.id));
  return (
    <Stack gap={space.sm} style={{ marginTop: space.lg }}>
      <Overline>Later this week</Overline>
      {later.flatMap((d) => (byDay.get(dateKey(d)) ?? []).filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
        .map((i) => <TaskRow key={i.id} item={i} tz={tz} />))}
    </Stack>
  );
}
