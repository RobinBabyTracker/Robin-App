import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Button, Label } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { colors, fonts, radius, space } from '@/ui/theme';
import { formatDate, type LocalDateTime } from '@/lib/time';

// Values are wall-clock parts in the person's profile time zone. The native
// picker works in device-local Dates, so we only use it to choose numbers.
const toDeviceDate = (v: LocalDateTime) => new Date(v.year, v.month - 1, v.day, v.hour, v.minute);
const fromDeviceDate = (d: Date): LocalDateTime => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() });

function timeLabel(v: LocalDateTime) {
  const h = v.hour % 12 === 0 ? 12 : v.hour % 12;
  return `${h}:${String(v.minute).padStart(2, '0')}${v.hour < 12 ? 'am' : 'pm'}`;
}

export function DateTimeField({ label, value, onChange, dateOnly, error }: {
  label: string; value: LocalDateTime; onChange: (v: LocalDateTime) => void; dateOnly?: boolean; error?: boolean;
}) {
  const [iosMode, setIosMode] = useState<'date' | 'time' | null>(null);

  const open = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toDeviceDate(value),
        mode,
        is24Hour: false,
        onValueChange: (_e, d) => { if (d) onChange(merge(value, fromDeviceDate(d), mode)); },
      });
    } else {
      setIosMode(iosMode === mode ? null : mode);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <FieldButton
          icon="calendar"
          text={formatDate(value, { weekday: true, year: true })}
          a11y={`${label} date: ${formatDate(value, { weekday: true, year: true })}. Change`}
          onPress={() => open('date')}
          error={error}
        />
        {!dateOnly ? (
          <FieldButton icon="clock" text={timeLabel(value)} a11y={`${label} time: ${timeLabel(value)}. Change`} onPress={() => open('time')} error={error} />
        ) : null}
      </View>
      {Platform.OS === 'ios' && iosMode ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: space.sm }}>
          <DateTimePicker
            value={toDeviceDate(value)}
            mode={iosMode}
            display={iosMode === 'date' ? 'inline' : 'spinner'}
            minuteInterval={5}
            accentColor={colors.primary}
            themeVariant="light"
            onValueChange={(_e, d) => { if (d) onChange(merge(value, fromDeviceDate(d), iosMode)); }}
          />
          <Button label="Done" variant="secondary" small onPress={() => setIosMode(null)} />
        </View>
      ) : null}
    </View>
  );
}

function merge(prev: LocalDateTime, next: LocalDateTime, mode: 'date' | 'time'): LocalDateTime {
  return mode === 'date'
    ? { ...prev, year: next.year, month: next.month, day: next.day }
    : { ...prev, hour: next.hour, minute: next.minute };
}

function FieldButton({ icon, text, a11y, onPress, error }: { icon: 'calendar' | 'clock'; text: string; a11y: string; onPress: () => void; error?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 14,
        borderRadius: radius.sm + 2, borderWidth: error ? 2 : 1.5, borderColor: error ? colors.danger : colors.textSecondary,
        backgroundColor: pressed ? colors.cream : colors.surface,
      })}
    >
      <Icon name={icon} size={18} />
      <Text maxFontSizeMultiplier={1.6} style={{ fontFamily: fonts.body, fontSize: 17, color: colors.text }}>{text}</Text>
    </Pressable>
  );
}
