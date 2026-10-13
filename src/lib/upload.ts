import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { rpc, supabase, MEDIA_BUCKET } from './supabase';
import { checkMedia, guessMime } from './forms';

// Upload pipeline:
//   1. create_media() reserves a private path (server checks type/size/length).
//   2. createSignedUploadUrl() — storage only accepts it for that reserved path.
//   3. PUT the file with progress.
//   4. finalize_media() — server confirms the file really arrived.
// Nothing is shown as sent/saved until step 4 succeeds.

export type PickedMedia = {
  key: string;
  uri: string;
  kind: 'photo' | 'video';
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  problem: string | null; // reason it can't be uploaded, if any
};

export type UploadState =
  | { status: 'queued' }
  | { status: 'uploading'; progress: number }
  | { status: 'done'; mediaId: string }
  | { status: 'failed'; error: unknown; mediaId?: string; path?: string };

let keySeq = 0;

export async function pickMedia(opts: { multiple?: boolean; photosOnly?: boolean } = {}): Promise<PickedMedia[] | 'denied' | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: opts.photosOnly ? ['images'] : ['images', 'videos'],
    allowsMultipleSelection: !!opts.multiple,
    selectionLimit: opts.multiple ? 10 : 1,
    quality: 0.85,
    videoMaxDuration: 180,
    exif: false,
  });
  if (res.canceled) return null;
  return res.assets.map(toPicked);
}

export async function takePhoto(): Promise<PickedMedia[] | 'denied' | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'denied';
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 180, exif: false });
  if (res.canceled) return null;
  return res.assets.map(toPicked);
}

function toPicked(a: ImagePicker.ImagePickerAsset): PickedMedia {
  const kind = a.type === 'video' ? 'video' : 'photo';
  const mime = guessMime(a.uri, a.mimeType, kind);
  let bytes = a.fileSize ?? 0;
  if (!bytes) {
    try { bytes = new File(a.uri).size ?? 0; } catch { bytes = 0; }
  }
  const durationMs = kind === 'video' ? (a.duration ?? null) : null;
  return {
    key: `m${Date.now()}_${keySeq++}`, uri: a.uri, kind, mime, bytes,
    width: a.width ?? null, height: a.height ?? null, durationMs,
    problem: checkMedia(kind, mime, bytes, durationMs),
  };
}

/**
 * Uploads one picked item into a family. Pass the previous failed state to
 * retry without reserving a new path.
 */
export async function uploadMedia(
  familyId: string,
  item: PickedMedia,
  onProgress: (fraction: number) => void,
  previous?: { mediaId?: string; path?: string },
): Promise<string> {
  if (item.problem) throw new Error(item.problem);
  let mediaId = previous?.mediaId;
  let path = previous?.path;
  if (!mediaId || !path) {
    const rows = await rpc<{ media_id: string; storage_path: string }[]>('create_media', {
      p_family: familyId, p_kind: item.kind, p_mime: item.mime, p_bytes: item.bytes,
      p_width: item.width, p_height: item.height, p_duration_ms: item.durationMs ? Math.round(item.durationMs) : null,
    });
    mediaId = rows[0].media_id;
    path = rows[0].storage_path;
  }
  if (previous?.mediaId) {
    // A retry: the file may have arrived even though confirming it failed.
    const { error } = await supabase.rpc('finalize_media', { p_media: mediaId });
    if (!error) { onProgress(1); return mediaId; }
  }
  try {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    const task = new File(item.uri).createUploadTask(data.signedUrl, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': item.mime },
      mimeType: item.mime,
      onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes ? bytesSent / totalBytes : 0),
    });
    const result = await task.uploadAsync();
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Upload failed (${result.status})`);
    }
    await rpc('finalize_media', { p_media: mediaId });
    onProgress(1);
    return mediaId;
  } catch (e) {
    await supabase.rpc('mark_media_failed', { p_media: mediaId });
    const err = e as Error & { mediaId?: string; path?: string };
    throw Object.assign(err instanceof Error ? err : new Error(String(e)), { mediaId, path });
  }
}

/** Short-lived signed URL for viewing. Fails unless the database says you may see it. */
export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
