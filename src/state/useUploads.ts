import { useCallback, useRef, useState } from 'react';
import { uploadMedia, type PickedMedia, type UploadState } from '@/lib/upload';

export type UploadEntry = { item: PickedMedia; state: UploadState };

/**
 * Tracks a batch of uploads with progress, failure and retry. Items only count
 * as done once the server has confirmed the file (finalize_media).
 */
export function useUploads(familyId: string) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const ref = useRef<UploadEntry[]>([]);
  ref.current = entries;

  const update = (key: string, state: UploadState) =>
    setEntries((es) => es.map((e) => (e.item.key === key ? { ...e, state } : e)));

  const run = useCallback(async (entry: UploadEntry) => {
    if (entry.item.problem) return;
    const prev = entry.state.status === 'failed' ? { mediaId: entry.state.mediaId, path: entry.state.path } : undefined;
    update(entry.item.key, { status: 'uploading', progress: 0 });
    try {
      const mediaId = await uploadMedia(familyId, entry.item, (p) => update(entry.item.key, { status: 'uploading', progress: p }), prev);
      update(entry.item.key, { status: 'done', mediaId });
    } catch (e) {
      const err = e as { mediaId?: string; path?: string };
      update(entry.item.key, { status: 'failed', error: e, mediaId: err.mediaId, path: err.path });
    }
  }, [familyId]);

  const add = useCallback((items: PickedMedia[]) => {
    const fresh = items.map((item) => ({ item, state: { status: 'queued' } as UploadState }));
    setEntries((es) => [...es, ...fresh]);
    // Upload one after another so progress is meaningful on slow connections.
    (async () => { for (const e of fresh) await run(e); })();
  }, [run]);

  const retry = useCallback((key: string) => {
    const e = ref.current.find((x) => x.item.key === key);
    if (e) run(e);
  }, [run]);

  const remove = useCallback((key: string) => setEntries((es) => es.filter((e) => e.item.key !== key)), []);
  const clear = useCallback(() => setEntries([]), []);

  const valid = entries.filter((e) => !e.item.problem);
  const busy = valid.some((e) => e.state.status === 'uploading' || e.state.status === 'queued');
  const failed = valid.some((e) => e.state.status === 'failed');
  const mediaIds = valid.flatMap((e) => (e.state.status === 'done' ? [e.state.mediaId] : []));
  const ready = valid.length > 0 && !busy && !failed && entries.every((e) => !e.item.problem);

  return { entries, add, retry, remove, clear, busy, failed, ready, mediaIds };
}
