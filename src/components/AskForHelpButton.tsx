import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Robin } from '@/ui/components';
import { colors, fonts } from '@/ui/theme';

/** Robin's floating quick action (from Amber's original concept), now labelled. */
export function AskForHelpButton({ date }: { date?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask for help or plan an event"
      onPress={() => router.push(date ? { pathname: '/task/new', params: { date } } : '/task/new')}
      style={({ pressed }) => ({
        position: 'absolute', right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
        minHeight: 56, paddingLeft: 6, paddingRight: 20, borderRadius: 999, backgroundColor: colors.primary,
        opacity: pressed ? 0.9 : 1, shadowColor: colors.text, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
      })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        <Robin pose="standing" size={34} />
      </View>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 16 }}>Ask for help</Text>
    </Pressable>
  );
}
