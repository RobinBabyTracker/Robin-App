import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Body, Caption, EmptyState, ErrorState, IconButton, Loading, Screen } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { MediaThumb, MediaViewer, PendingUpload } from '@/components/media';
import { useAuth } from '@/state/auth';
import { useFamily } from '@/state/family';
import { keys, useConversation, useMembers, useMessages } from '@/state/queries';
import { useUploads } from '@/state/useUploads';
import { pickMedia, takePhoto } from '@/lib/upload';
import { rpc, supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatTime, relativeDayLabel, zonedParts } from '@/lib/time';
import type { Media, Message } from '@/lib/types';
import { colors, fonts, radius, space } from '@/ui/theme';

type Outgoing = { clientId: string; body: string; mediaIds: string[]; status: 'sending' | 'failed'; error?: unknown };

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const { userId, timezone } = useAuth();
  const { familyId } = useFamily();
  const qc = useQueryClient();
  const conv = useConversation(id);
  const members = useMembers(familyId);
  const msgs = useMessages(id);
  const uploads = useUploads(familyId);
  const [text, setText] = useState('');
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ media: Media; messageId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const markedRef = useRef<string | null>(null);

  const all = useMemo(() => (msgs.data?.pages ?? []).flat(), [msgs.data]);
  const newest = all[0]?.created_at ?? null;

  // Mark as read when opened and whenever a newer message arrives.
  useEffect(() => {
    if (!id || markedRef.current === newest) return;
    markedRef.current = newest;
    supabase.rpc('mark_conversation_read', { p_conversation: id }).then(() => {
      qc.invalidateQueries({ queryKey: keys.conversations(familyId) });
      qc.invalidateQueries({ queryKey: keys.notifications });
    });
  }, [id, newest, familyId, qc]);

  const nameOf = (uid: string | null) =>
    uid === userId ? 'You' : members.data?.find((m) => m.user_id === uid)?.profile?.display_name ?? 'Former member';

  const title = conv.data ? (conv.data.kind === 'group' ? conv.data.name ?? 'Group chat' : nameOf(conv.data.members.find((m) => m.user_id !== userId)?.user_id ?? null)) : '';
  const others = (conv.data?.members ?? []).filter((m) => m.user_id !== userId);
  const readCount = (createdAt: string) => others.filter((m) => new Date(m.last_read_at) >= new Date(createdAt)).length;

  const send = async (item?: Outgoing) => {
    setError(null);
    const out: Outgoing = item ?? { clientId: Crypto.randomUUID(), body: text.trim(), mediaIds: uploads.mediaIds, status: 'sending' };
    if (!item) {
      if (!out.body && !out.mediaIds.length) return;
      setText('');
      uploads.clear();
      setOutbox((o) => [...o, out]);
    } else {
      setOutbox((o) => o.map((x) => (x.clientId === out.clientId ? { ...x, status: 'sending', error: undefined } : x)));
    }
    try {
      // Same clientId on retry: the server never stores a message twice.
      await rpc('send_message', { p_conversation: id, p_body: out.body || null, p_client_id: out.clientId, p_media: out.mediaIds });
      await qc.invalidateQueries({ queryKey: keys.messages(id) });
      setOutbox((o) => o.filter((x) => x.clientId !== out.clientId));
      qc.invalidateQueries({ queryKey: keys.conversations(familyId) });
    } catch (e) {
      setOutbox((o) => o.map((x) => (x.clientId === out.clientId ? { ...x, status: 'failed', error: e } : x)));
    }
  };

  const attach = async (source: 'library' | 'camera') => {
    setError(null);
    const res = source === 'camera' ? await takePhoto() : await pickMedia({ multiple: true });
    if (res === 'denied') { setError(source === 'camera' ? 'Robin needs camera access. You can allow it in Settings.' : 'Robin needs access to your photos. You can allow it in Settings.'); return; }
    if (res) uploads.add(res);
  };

  const onLongPress = (m: Message) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    const media = (m.message_attachments ?? []).map((a) => a.media).filter(Boolean) as Media[];
    if (media.length) buttons.push({ text: media.length === 1 ? 'Save to Memories' : `Save ${media.length} to Memories`, onPress: () => saveToMemories(m, media) });
    if (m.sender_id === userId && !m.deleted_at) buttons.push({ text: 'Delete message', style: 'destructive', onPress: () => confirmDelete(m) });
    if (!buttons.length) return;
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Message', undefined, buttons);
  };

  const saveToMemories = async (m: Message, media: Media[]) => {
    try {
      for (const md of media) await rpc('add_memory', { p_media: md.id, p_source_message: m.id, p_taken_on: m.created_at.slice(0, 10) });
      qc.invalidateQueries({ queryKey: keys.memories(familyId) });
      const msg = media.length === 1 ? 'Saved to Memories.' : `${media.length} saved to Memories.`;
      setNotice(msg);
      AccessibilityInfo.announceForAccessibility(msg);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const confirmDelete = (m: Message) => {
    Alert.alert('Delete this message?', 'It will be removed for everyone in this chat.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(m) },
    ]);
  };

  const deleteMessage = async (m: Message) => {
    try {
      await rpc('delete_message', { p_message: m.id });
      qc.invalidateQueries({ queryKey: keys.messages(id) });
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  if (conv.isLoading || msgs.isLoading) return <Screen><Loading /></Screen>;
  if (conv.error || msgs.error) return <Screen><ErrorState error={conv.error ?? msgs.error} onRetry={() => { conv.refetch(); msgs.refetch(); }} /></Screen>;
  if (!conv.data) return <Screen><EmptyState title="This chat isn't available" body="You may have left it, or it was removed." action={{ label: 'Back', onPress: () => router.back() }} /></Screen>;

  const canSend = (!!text.trim() || uploads.ready) && !uploads.busy && !uploads.failed && uploads.entries.every((e) => !e.item.problem);

  return (
    // Android draws edge to edge, so the window no longer shrinks for the
    // keyboard: pad the screen ourselves on both platforms.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <RouterStack.Screen options={{
        title,
        headerRight: () => <IconButton icon="more" label="Chat details" onPress={() => router.push(`/chat/${id}/details`)} />,
      }} />
      {error ? <View style={{ padding: space.sm }}><Banner tone="error" text={error} action={{ label: 'Dismiss', onPress: () => setError(null) }} /></View> : null}
      {notice ? <View style={{ padding: space.sm }}><Banner tone="success" text={notice} action={{ label: 'OK', onPress: () => setNotice(null) }} /></View> : null}
      {!all.length && !outbox.length ? (
        // Shown outside the list: an inverted list would draw it upside down or mirrored.
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }} keyboardShouldPersistTaps="handled">
          <EmptyState title="Say hello" body="Messages and photos here are only seen by people in this chat." />
        </ScrollView>
      ) : (
      <FlatList
        inverted
        data={all}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        onEndReached={() => { if (msgs.hasNextPage && !msgs.isFetchingNextPage) msgs.fetchNextPage(); }}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={{ gap: space.sm }}>
            {[...outbox].reverse().map((o) => (
              <View key={o.clientId} style={{ alignSelf: 'flex-end', maxWidth: '80%', gap: 4 }}>
                <View style={[bubble(true), { opacity: o.status === 'sending' ? 0.7 : 1 }]}>
                  {o.mediaIds.length ? <Caption style={{ color: colors.cream }}>{o.mediaIds.length} photo{o.mediaIds.length === 1 ? '' : 's'} or video{o.mediaIds.length === 1 ? '' : 's'}</Caption> : null}
                  {o.body ? <Body style={{ color: colors.onPrimary }}>{o.body}</Body> : null}
                </View>
                {o.status === 'sending' ? <View accessibilityLiveRegion="polite"><Caption style={{ textAlign: 'right' }}>Sending…</Caption></View> : (
                  <Pressable accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel="Not sent. Tap to try again" onPress={() => send(o)} style={{ flexDirection: 'row', gap: 4, alignSelf: 'flex-end', alignItems: 'center', minHeight: 48, paddingLeft: space.md }}>
                    <Icon name="alert" size={14} color={colors.danger} />
                    <Caption style={{ color: colors.danger }}>Not sent · Tap to retry</Caption>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        }
        ListFooterComponent={msgs.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : !msgs.hasNextPage && all.length ? <Caption style={{ textAlign: 'center', marginBottom: space.lg }}>Start of your chat</Caption> : null}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: m, index }) => {
          const mine = m.sender_id === userId;
          const older = all[index + 1];
          const showDay = !older || dayKey(older.created_at, timezone) !== dayKey(m.created_at, timezone);
          const showName = conv.data!.kind === 'group' && !mine && (!older || older.sender_id !== m.sender_id || showDay);
          const media = (m.message_attachments ?? []).sort((a, b) => a.position - b.position).map((a) => a.media).filter(Boolean) as Media[];
          const isLatestMine = mine && all.find((x) => x.sender_id === userId)?.id === m.id;
          const reads = mine ? readCount(m.created_at) : 0;
          const hasOptions = media.length > 0 || (mine && !m.deleted_at);
          return (
            <View style={{ gap: 4 }}>
              {showDay ? <Caption style={{ textAlign: 'center', marginVertical: space.sm }}>{dayLabel(m.created_at, timezone)}</Caption> : null}
              {showName ? <Caption style={{ marginLeft: 4 }}>{nameOf(m.sender_id)}</Caption> : null}
              <Pressable
                // Tap or long-press a message for options; screen readers get the same options as actions.
                onPress={hasOptions ? () => onLongPress(m) : undefined}
                onLongPress={hasOptions ? () => onLongPress(m) : undefined}
                accessible={!media.length}
                accessibilityRole={hasOptions ? 'button' : 'text'}
                accessibilityLabel={`${mine ? 'You' : nameOf(m.sender_id)}: ${m.deleted_at ? 'message deleted' : m.body ?? ''}. ${formatTime(m.created_at, timezone)}`}
                accessibilityHint={hasOptions ? 'Opens message options' : undefined}
                accessibilityActions={[
                  ...(media.length ? [{ name: 'save', label: 'Save to Memories' }] : []),
                  ...(mine && !m.deleted_at ? [{ name: 'delete', label: 'Delete message' }] : []),
                ]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'save') saveToMemories(m, media);
                  if (e.nativeEvent.actionName === 'delete') confirmDelete(m);
                }}
                style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', gap: 4 }}
              >
                {media.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    {media.map((md) => <MediaThumb key={md.id} media={md} size={media.length === 1 ? 220 : 120} onPress={() => setViewer({ media: md, messageId: m.id })} />)}
                  </View>
                ) : null}
                {m.deleted_at ? (
                  <View style={[bubble(false), { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}><Caption>Message deleted</Caption></View>
                ) : m.body ? (
                  <View style={bubble(mine)}><Body style={{ color: mine ? colors.onPrimary : colors.text }}>{m.body}</Body></View>
                ) : null}
                <Caption style={{ textAlign: mine ? 'right' : 'left' }}>
                  {formatTime(m.created_at, timezone)}
                  {isLatestMine ? (reads === 0 ? ' · Delivered' : others.length === 1 || reads === others.length ? ' · Read' : ` · Read by ${reads}`) : ''}
                </Caption>
              </Pressable>
            </View>
          );
        }}
      />
      )}

      {uploads.entries.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: space.sm, padding: space.sm }} style={{ maxHeight: 210, backgroundColor: colors.cream }}>
          {uploads.entries.map((e) => (
            <PendingUpload key={e.item.key} item={e.item} state={e.state} onRetry={() => uploads.retry(e.item.key)} onRemove={() => uploads.remove(e.item.key)} />
          ))}
        </ScrollView>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: space.sm, paddingBottom: Math.max(insets.bottom, space.sm), backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
        <IconButton icon="image" label="Add photos or videos" onPress={() => attach('library')} />
        <IconButton icon="camera" label="Take a photo or video" onPress={() => attach('camera')} />
        <TextInput
          accessibilityLabel="Message"
          placeholder="Message"
          placeholderTextColor={colors.textSecondary}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
          style={{ flex: 1, minHeight: 44, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.textSecondary, backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 17, color: colors.text }}
          maxFontSizeMultiplier={1.8}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uploads.busy ? 'Send, waiting for uploads to finish' : 'Send'}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => send()}
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? colors.primary : colors.disabledBg }}
        >
          <Icon name="send" size={22} color={canSend ? colors.onPrimary : colors.textSecondary} />
        </Pressable>
      </View>

      <MediaViewer
        visible={!!viewer}
        media={viewer?.media ?? null}
        onClose={() => setViewer(null)}
        actions={viewer ? (
          <Pressable accessibilityRole="button" onPress={() => { const m = all.find((x) => x.id === viewer.messageId); if (m) saveToMemories(m, [viewer.media]); setViewer(null); }}
            style={{ minHeight: 48, borderRadius: 24, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
            <Body style={{ fontFamily: fonts.bold }}>Save to Memories</Body>
          </Pressable>
        ) : null}
      />
    </KeyboardAvoidingView>
  );
}

const bubble = (mine: boolean) => ({
  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
  backgroundColor: mine ? colors.primary : colors.surface,
  borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
});

const dayKey = (iso: string, tz: string) => { const p = zonedParts(iso, tz); return `${p.year}-${p.month}-${p.day}`; };
const dayLabel = (iso: string, tz: string) => { const p = zonedParts(iso, tz); return relativeDayLabel({ year: p.year, month: p.month, day: p.day }, tz); };
