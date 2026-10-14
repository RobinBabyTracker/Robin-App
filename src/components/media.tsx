import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Caption, IconButton, ProgressBar, Strong } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { useMediaUrl } from '@/state/queries';
import type { Media } from '@/lib/types';
import type { PickedMedia, UploadState } from '@/lib/upload';
import { friendlyError } from '@/lib/errors';
import { colors, radius, space } from '@/ui/theme';

type MediaLike = Pick<Media, 'storage_path' | 'kind' | 'status'> & Partial<Pick<Media, 'width' | 'height' | 'duration_ms'>>;

/** A private photo/video thumbnail, loaded through a short-lived signed URL. */
export function MediaThumb({ media, size = 160, onPress, label }: { media: MediaLike; size?: number | `${number}%`; onPress?: () => void; label?: string }) {
  const url = useMediaUrl(media.status === 'ready' ? media.storage_path : null);
  const box = { width: size, aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden' as const, backgroundColor: colors.cream };
  const content = media.status !== 'ready' ? (
    <View style={[box, { alignItems: 'center', justifyContent: 'center', padding: 8 }]}>
      <Caption style={{ textAlign: 'center' }}>{media.status === 'deleted' ? 'Removed' : 'Not available'}</Caption>
    </View>
  ) : url.error ? (
    <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
      <Icon name="eyeOff" color={colors.textSecondary} />
    </View>
  ) : (
    <View style={box}>
      {url.data && media.kind === 'photo' ? (
        <Image source={{ uri: url.data }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={0} recyclingKey={media.storage_path} accessibilityIgnoresInvertColors />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {url.isLoading ? <ActivityIndicator color={colors.primary} /> : <Icon name="video" size={32} />}
        </View>
      )}
      {media.kind === 'video' ? (
        <View style={{ position: 'absolute', bottom: 6, left: 6, backgroundColor: colors.text, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <Icon name="video" size={12} color={colors.cream} />
          <Caption style={{ color: colors.cream, fontSize: 11 }}>{media.duration_ms ? `${Math.floor(media.duration_ms / 60000)}:${String(Math.floor((media.duration_ms % 60000) / 1000)).padStart(2, '0')}` : 'Video'}</Caption>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label ?? (media.kind === 'photo' ? 'Open photo' : 'Open video')} onPress={onPress}>
      {content}
    </Pressable>
  );
}

/** Full-screen viewer for one photo or video. */
export function MediaViewer({ media, visible, onClose, caption, actions }: {
  media: MediaLike | null; visible: boolean; onClose: () => void; caption?: string | null; actions?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible && !!media} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: '#1d1b09', paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: space.sm }}>
          <IconButton icon="close" label="Close" color={colors.cream} onPress={onClose} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>{media ? <ViewerBody media={media} /> : null}</View>
        {caption ? <Strong style={{ color: colors.cream, padding: space.lg }}>{caption}</Strong> : null}
        {actions ? <View style={{ padding: space.lg, gap: space.sm }}>{actions}</View> : null}
      </View>
    </Modal>
  );
}

function ViewerBody({ media }: { media: MediaLike }) {
  const url = useMediaUrl(media.storage_path);
  if (url.isLoading) return <ActivityIndicator color={colors.cream} size="large" />;
  if (url.error || !url.data) return <Caption style={{ color: colors.cream, textAlign: 'center' }}>{friendlyError(url.error, 'This can’t be shown. It may have been removed.')}</Caption>;
  if (media.kind === 'photo') {
    return <Image source={{ uri: url.data }} style={{ width: '100%', height: '100%' }} contentFit="contain" accessibilityLabel="Photo" />;
  }
  return <VideoBody uri={url.data} />;
}

function VideoBody({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls />;
}

/** A picked item waiting to upload, with progress, failure and retry. */
export function PendingUpload({ item, state, onRetry, onRemove }: { item: PickedMedia; state: UploadState; onRetry: () => void; onRemove: () => void }) {
  const failed = state.status === 'failed' || !!item.problem;
  return (
    <View style={{ width: 120, gap: 6 }}>
      <View style={{ width: 120, height: 120, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.cream, borderWidth: failed ? 2 : 0, borderColor: colors.danger }}>
        {item.kind === 'photo' ? <Image source={{ uri: item.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Icon name="video" size={32} /></View>
        )}
        <View style={{ position: 'absolute', top: 2, right: 2, borderRadius: 24, backgroundColor: colors.cream }}>
          <IconButton icon="close" label={`Remove this ${item.kind === 'photo' ? 'photo' : 'video'}`} onPress={onRemove} />
        </View>
      </View>
      {item.problem ? <Caption style={{ color: colors.danger }}>{item.problem}</Caption>
        : state.status === 'uploading' ? <ProgressBar progress={state.progress} label={`Uploading, ${Math.round(state.progress * 100)} percent`} />
        : state.status === 'done' ? <Caption>Ready</Caption>
        : state.status === 'failed' ? (
          <>
            <Caption style={{ color: colors.danger }}>{friendlyError(state.error, 'Upload failed.')}</Caption>
            <Button label="Retry" icon="refresh" small variant="secondary" onPress={onRetry} />
          </>
        ) : <Caption>Waiting…</Caption>}
    </View>
  );
}
