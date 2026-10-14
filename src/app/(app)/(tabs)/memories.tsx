import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { AppHeader } from '@/components/AppHeader';
import { MediaThumb } from '@/components/media';
import { Button, Caption, EmptyState, ErrorState, Loading, Overline } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { useFamily } from '@/state/family';
import { useMemories } from '@/state/queries';
import { monthName, parseDateKey } from '@/lib/time';
import type { Memory } from '@/lib/types';
import { colors, space } from '@/ui/theme';

export default function Memories() {
  const { familyId, current } = useFamily();
  const q = useMemories(familyId);
  const { width } = useWindowDimensions();
  const cols = width > 700 ? 5 : 3;
  const gap = 6;
  const size = Math.floor((width - space.lg * 2 - gap * (cols - 1)) / cols);

  const sections = useMemo(() => {
    const items = (q.data?.pages ?? []).flat();
    const groups = new Map<string, Memory[]>();
    for (const m of items) {
      const d = parseDateKey(m.taken_on);
      const k = `${monthName(d.month)} ${d.year}`;
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    return [...groups.entries()].map(([title, ms]) => ({
      title,
      data: Array.from({ length: Math.ceil(ms.length / cols) }, (_, i) => ms.slice(i * cols, i * cols + cols)),
    }));
  }, [q.data, cols]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader title="Memories" />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.map((m) => m.id).join('-')}
          contentContainerStyle={{ padding: space.lg, paddingBottom: 120, gap }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
          ListHeaderComponent={
            <View style={{ gap: space.md, marginBottom: space.md }}>
              <Button label="Add photos or videos" icon="plus" onPress={() => router.push('/memory/new')} />
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Icon name="lock" size={14} color={colors.textSecondary} />
                <Caption>Private to {current?.name ?? 'your family'}. Never public.</Caption>
              </View>
            </View>
          }
          renderSectionHeader={({ section }) => <View style={{ backgroundColor: colors.background, paddingVertical: space.sm }}><Overline>{section.title}</Overline></View>}
          renderItem={({ item: row }) => (
            <View style={{ flexDirection: 'row', gap, marginBottom: gap }}>
              {row.map((m) => m.media ? (
                <MediaThumb key={m.id} media={m.media} size={size} label={`${m.media.kind === 'photo' ? 'Photo' : 'Video'}${m.caption ? `: ${m.caption}` : ''}. Open`} onPress={() => router.push(`/memory/${m.id}`)} />
              ) : null)}
            </View>
          )}
          ListEmptyComponent={
            <EmptyState title="Your family's memories live here" body="Add photos and videos, or save them from a chat. Only your family can see them." />
          }
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
          stickySectionHeadersEnabled
        />
      )}
    </View>
  );
}
