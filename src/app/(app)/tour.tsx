import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Caption, Label, Loading, Robin, Title, Voice, type RobinPose } from '@/ui/components';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { guide } from '@/lib/guide';
import { colors, radius, space } from '@/ui/theme';

type Slide = { pose: RobinPose; title: string; body: string; where?: string };

// Robin talks people through the app the first time they arrive. Parents and
// helpers do different things, so they get slightly different tours.
const PARENT_SLIDES: Slide[] = [
  { pose: 'singing', title: 'Hello, I’m Robin', body: 'I’m here to help your family help you. Here’s how it all works. It only takes a minute.' },
  {
    pose: 'flying', title: 'First, invite your people',
    body: 'Robin works best once your family is in it: grandparents, friends, a sitter you trust. Send each of them a private link, and once they’ve joined you can ask them for help.',
    where: 'Tap your picture at the top right, then Invite someone.',
  },
  {
    pose: 'standing', title: 'Ask for a hand',
    body: 'Say what you need and when, then choose who to ask. The first person to say yes gets it, and everyone else hears it’s covered. You can plan family events here too.',
    where: 'Tap Ask for help at the bottom of Home.',
  },
  {
    pose: 'pecking', title: 'One calendar for everyone',
    body: 'Requests and events land in the calendar, shown in each person’s own time zone. Switch between your plans and the whole family’s.',
    where: 'Tap Calendar at the bottom of the screen.',
  },
  {
    pose: 'singing', title: 'Chat and keep memories',
    body: 'Message one person or the whole group, and share photos and videos. Save favourites to Memories, and keep any for parents only.',
    where: 'Tap Messages or Memories at the bottom of the screen.',
  },
  { pose: 'standing', title: 'You’re all set', body: 'I’ll keep a short checklist on Home to help you get going. You can watch this tour again any time from You & family.' },
];

const HELPER_SLIDES: Slide[] = [
  { pose: 'singing', title: 'Hello, I’m Robin', body: 'Thank you for being one of this family’s helpers. Here’s how it all works. It only takes a minute.' },
  {
    pose: 'standing', title: 'Say yes when you can',
    body: 'When the family needs a hand, I’ll show you on Home. Tap I can help if you’re free. It’s always fine to say Not this time.',
    where: 'Look under Needs your reply on Home.',
  },
  {
    pose: 'pecking', title: 'See what’s coming up',
    body: 'Everything you’re helping with or invited to is in the calendar, shown in your own time zone.',
    where: 'Tap Calendar at the bottom of the screen.',
  },
  {
    pose: 'singing', title: 'Chat and share memories',
    body: 'Message the family, share photos and videos, and look back on Memories together.',
    where: 'Tap Messages or Memories at the bottom of the screen.',
  },
  { pose: 'standing', title: 'You’re all set', body: 'You can watch this tour again any time from You & family.' },
];

export default function Tour() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { userId } = useAuth();
  const { isParent, loading } = useFamily();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  // Count the tour as seen as soon as it opens, so it never nags.
  useEffect(() => { if (userId) guide.markTourSeen(userId); }, [userId]);

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.background }}><Loading /></View>;

  const slides = isParent ? PARENT_SLIDES : HELPER_SLIDES;
  const last = page === slides.length - 1;

  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setPage(i);
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg, minHeight: 48 }}>
        {!last ? <Button label="Skip" variant="text" small onPress={close} accessibilityLabel="Skip the tour" /> : null}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}
      >
        {slides.map((s, i) => (
          <ScrollView
            key={s.title}
            style={{ width }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.xl, gap: space.lg }}
            accessibilityLabel={`Step ${i + 1} of ${slides.length}`}
          >
            <Robin pose={s.pose} size={160} />
            <Title style={{ textAlign: 'center' }}>{s.title}</Title>
            <Voice style={{ textAlign: 'center' }}>{s.body}</Voice>
            {s.where ? (
              <View style={{ backgroundColor: colors.cream, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg, alignSelf: 'stretch' }}>
                <Label style={{ textAlign: 'center' }}>{s.where}</Label>
              </View>
            ) : null}
          </ScrollView>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.sm, paddingVertical: space.lg }}>
        {slides.map((s, i) => (
          <Pressable
            key={s.title}
            accessibilityRole="button"
            accessibilityLabel={`Go to step ${i + 1}`}
            accessibilityState={{ selected: i === page }}
            onPress={() => goTo(i)}
            hitSlop={8}
          >
            <View style={{ width: i === page ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? colors.primary : colors.textSecondary, opacity: i === page ? 1 : 0.4 }} />
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        {last ? (
          isParent ? (
            <>
              <Button label="Invite someone now" icon="plus" onPress={() => router.replace('/settings/invite')} />
              <Button label="Go to Home" variant="secondary" onPress={close} />
            </>
          ) : (
            <Button label="Go to Home" onPress={close} />
          )
        ) : (
          <Button label="Next" onPress={() => goTo(page + 1)} />
        )}
        <Caption style={{ textAlign: 'center' }}>{`${page + 1} of ${slides.length}`}</Caption>
      </View>
    </View>
  );
}
