import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type PressableProps, type ScrollViewProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { colors, radius, space, touch, type, fonts } from './theme';
import { Icon, type IconName } from './Icon';
import { ROBIN_FLYING, ROBIN_PECKING, ROBIN_SINGING, ROBIN_STANDING } from './robinArt';
import { friendlyError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type TP = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; color?: string; accessibilityRole?: 'header' | 'text' | 'alert'; selectable?: boolean };

const make = (base: TextStyle, role?: 'header') =>
  function T({ children, style, numberOfLines, color, accessibilityRole, selectable }: TP) {
    return (
      <Text
        accessibilityRole={accessibilityRole ?? role}
        numberOfLines={numberOfLines}
        selectable={selectable}
        maxFontSizeMultiplier={2}
        style={[{ color: color ?? colors.text }, base, style]}
      >
        {children}
      </Text>
    );
  };

export const Display = make(type.display, 'header');
export const Title = make(type.title, 'header');
export const Heading = make(type.heading, 'header');
export const Body = make(type.body);
export const Strong = make(type.bodyStrong);
export const Label = make(type.label);
export const Caption = make({ ...type.caption, color: colors.textSecondary });
export const Overline = make({ ...type.overline, color: colors.textSecondary }, 'header');
export const Voice = make(type.voice);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children, scroll = true, edges = ['left', 'right'], padded = true, refreshControl, contentStyle, footer, keyboardShouldPersistTaps,
}: {
  children: React.ReactNode; scroll?: boolean; edges?: Edge[]; padded?: boolean; footer?: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>; contentStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
}) {
  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, { paddingBottom: 120 }, contentStyle]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && styles.padded, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {inner}
      {footer}
    </SafeAreaView>
  );
}

export function Stack({ gap = space.md, children, style, row, align }: { gap?: number; children: React.ReactNode; style?: StyleProp<ViewStyle>; row?: boolean; align?: ViewStyle['alignItems'] }) {
  return <View style={[{ gap, flexDirection: row ? 'row' : 'column', alignItems: align }, style]}>{children}</View>;
}

export function Card({ children, style, tone = 'surface' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'surface' | 'cream' }) {
  return <View style={[styles.card, tone === 'cream' && { backgroundColor: colors.cream, borderColor: colors.cream }, style]}>{children}</View>;
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm, marginTop: space.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Overline>{title}</Overline>
        {action}
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
};

export function Button({ label, variant = 'primary', loading, disabled, icon, style, small, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      hitSlop={small ? 4 : 0}
      style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
        styles.button,
        small && { minHeight: 40, paddingHorizontal: space.md },
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.text },
        variant === 'danger' && { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.danger },
        variant === 'text' && { backgroundColor: 'transparent', paddingHorizontal: space.sm },
        isDisabled && !loading && { backgroundColor: colors.disabledBg, borderColor: colors.border, borderStyle: 'dashed', borderWidth: 1.5 },
        pressed && { opacity: 0.85 },
        focused && styles.focus,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={isDisabled ? colors.disabledText : fg} /> : null}
          <Text
            maxFontSizeMultiplier={1.6}
            style={[type.label, { color: isDisabled ? colors.disabledText : fg }, variant === 'text' && { textDecorationLine: 'underline', color: colors.primary }]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, badge, color = colors.text, disabled }: { icon: IconName; label: string; onPress: () => void; badge?: boolean; color?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: 'rgba(60,56,19,0.08)' }]}
    >
      <Icon name={icon} size={24} color={disabled ? colors.border : color} />
      {badge ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function TextField({ label, error, hint, style, multiline, ...rest }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.textSecondary}
        maxFontSizeMultiplier={1.8}
        multiline={multiline}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        style={[
          styles.input,
          multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
          focused && { borderColor: colors.primary, borderWidth: 2 },
          !!error && { borderColor: colors.danger, borderWidth: 2 },
          style,
        ]}
        {...rest}
      />
      {error ? <FieldError text={error} /> : hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export function FieldError({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }} accessibilityLiveRegion="polite">
      <Icon name="alert" size={16} color={colors.danger} />
      <Text accessibilityRole="alert" style={[type.caption, { color: colors.danger, fontFamily: fonts.bold, flexShrink: 1 }]}>{text}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: colors.primary }]}
          >
            <Text maxFontSizeMultiplier={1.5} style={[type.label, { color: on ? colors.onPrimary : colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChoiceChip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.choice, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
    >
      {icon ? <Icon name={icon} size={18} color={selected ? colors.onPrimary : colors.text} /> : null}
      <Text maxFontSizeMultiplier={1.6} style={[type.label, { color: selected ? colors.onPrimary : colors.text }]}>{label}</Text>
      {selected ? <Icon name="check" size={16} color={colors.onPrimary} /> : null}
    </Pressable>
  );
}

export function ToggleRow({ label, hint, value, onValueChange, disabled }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.row, { minHeight: 56 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Label>{label}</Label>
        {hint ? <Caption>{hint}</Caption> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Status and feedback
// ---------------------------------------------------------------------------

export type TaskStatus = 'draft' | 'open' | 'confirmed' | 'completed' | 'cancelled';

export function Pill({ label, icon, tone = 'pink' }: { label: string; icon?: IconName; tone?: 'pink' | 'olive' | 'outline' | 'dashed' | 'muted' }) {
  const bg = tone === 'pink' ? colors.background : tone === 'olive' ? colors.text : tone === 'muted' ? colors.disabledBg : 'transparent';
  const fg = tone === 'olive' ? colors.cream : tone === 'muted' ? colors.primary : colors.text;
  return (
    <View
      style={[
        styles.pill, { backgroundColor: bg },
        tone === 'outline' && { borderWidth: 1.5, borderColor: colors.text },
        tone === 'dashed' && { borderWidth: 1.5, borderColor: colors.textSecondary, borderStyle: 'dashed' },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={fg} strokeWidth={2.4} /> : null}
      <Text maxFontSizeMultiplier={1.6} style={[type.caption, { color: fg, fontFamily: fonts.bold }]}>{label}</Text>
    </View>
  );
}

export function Banner({ text, tone = 'info', action }: { text: string; tone?: 'info' | 'error' | 'success'; action?: { label: string; onPress: () => void } }) {
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.banner, tone === 'error' && { borderColor: colors.danger, borderWidth: 2 }, tone === 'success' && { backgroundColor: colors.cream }]}
    >
      <Icon name={tone === 'error' ? 'alert' : tone === 'success' ? 'checkCircle' : 'clock'} size={20} color={tone === 'error' ? colors.danger : colors.text} />
      <Text style={[type.label, { flex: 1, color: tone === 'error' ? colors.danger : colors.text }]}>{text}</Text>
      {action ? <Button label={action.label} variant="text" small onPress={action.onPress} /> : null}
    </View>
  );
}

const POSES = { standing: ROBIN_STANDING, singing: ROBIN_SINGING, pecking: ROBIN_PECKING, flying: ROBIN_FLYING };
export type RobinPose = keyof typeof POSES;

export function Robin({ pose = 'standing', size = 64 }: { pose?: RobinPose; size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <SvgXml xml={POSES[pose]} width={size} height={size} />
    </View>
  );
}

export function RobinNote({ text, pose = 'standing', chirp }: { text: string; pose?: RobinPose; chirp?: boolean }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.cream, borderColor: colors.cream, flexDirection: 'row', gap: space.md, alignItems: 'center' }]}>
      <Robin pose={pose} size={52} />
      <Voice style={{ flex: 1 }}>
        {text}
        {chirp ? <Text style={{ fontSize: 11 }}> *chirp*</Text> : null}
      </Voice>
    </View>
  );
}

export function EmptyState({ title, body, pose = 'pecking', action }: { title: string; body?: string; pose?: RobinPose; action?: { label: string; onPress: () => void; icon?: IconName } }) {
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg }}>
      <Robin pose={pose} size={96} />
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {body ? <Voice style={{ textAlign: 'center', color: colors.textSecondary }}>{body}</Voice> : null}
      {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, title = 'That didn’t load' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }} accessibilityRole="alert">
      <Robin pose="pecking" size={80} />
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      <Body style={{ textAlign: 'center', color: colors.textSecondary }}>{friendlyError(error)}</Body>
      {onRetry ? <Button label="Try again" icon="refresh" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={{ padding: space.xxl, alignItems: 'center' }} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function ProgressBar({ progress, label }: { progress: number; label: string }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: colors.primary }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// People and rows
// ---------------------------------------------------------------------------

export function initials(name: string | null | undefined) {
  const parts = (name ?? '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, size = 44, tone = 'pink' }: { name: string | null | undefined; size?: number; tone?: 'pink' | 'olive' | 'cream' }) {
  const bg = tone === 'pink' ? colors.background : tone === 'olive' ? colors.text : colors.cream;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: tone === 'cream' ? 1 : 0, borderColor: colors.border }}
    >
      <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: fonts.bold, fontSize: size * 0.36, color: tone === 'olive' ? colors.cream : colors.text }}>{initials(name)}</Text>
    </View>
  );
}

export function ListRow({
  title, subtitle, left, right, onPress, accessibilityLabel, last, chevron = !!onPress,
}: { title: string; subtitle?: string; left?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; last?: boolean; chevron?: boolean }) {
  const content = (
    <>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Strong numberOfLines={1}>{title}</Strong>
        {subtitle ? <Caption numberOfLines={2}>{subtitle}</Caption> : null}
      </View>
      {right}
      {chevron ? <Icon name="chevronRight" size={20} color={colors.textSecondary} /> : null}
    </>
  );
  const style = [styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.divider }];
  if (!onPress) return <View style={style} accessibilityLabel={accessibilityLabel}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: colors.cream }]}>
      {content}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { padding: space.lg },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  button: {
    minHeight: touch, borderRadius: radius.pill, paddingHorizontal: space.xl, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  focus: { borderWidth: 3, borderColor: colors.primary },
  iconButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.background },
  input: {
    minHeight: touch, borderRadius: radius.sm + 2, borderWidth: 1.5, borderColor: colors.textSecondary, backgroundColor: colors.surface,
    paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 17, color: colors.text,
  },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.text, backgroundColor: colors.surface,
  },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 64 },
});
