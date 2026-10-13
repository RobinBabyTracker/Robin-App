// Form validation and small parsing helpers. Pure: unit tested with Node.
// The database enforces the same rules; these exist to give friendly,
// immediate feedback before anything is sent.

export type TaskKind = 'help' | 'event';
export type TaskCategory = 'childcare' | 'meals' | 'errands' | 'appointment' | 'family_event' | 'other';

export type TaskDraft = {
  kind: TaskKind;
  category: TaskCategory;
  title: string;
  description: string;
  location: string;
  notes: string;
  links: string[];
  allDay: boolean;
  startsAt: Date;
  endsAt: Date;
  respondBy: Date | null;
  helpersNeeded: number;
  invitees: string[] | null; // null = everyone
};

export type FieldErrors = Partial<Record<'title' | 'time' | 'respondBy' | 'links' | 'invitees' | 'helpersNeeded' | 'notes' | 'description' | 'location', string>>;

export function validateTask(d: TaskDraft, now = new Date(), opts: { sending: boolean; editing?: boolean } = { sending: true }): FieldErrors {
  const e: FieldErrors = {};
  const title = d.title.trim();
  if (!title) e.title = d.kind === 'help' ? 'Add a short title, like "School pick-up".' : 'Give your event a name.';
  else if (title.length > 120) e.title = 'Keep the title under 120 characters.';
  if (d.description.length > 2000) e.description = 'That description is a little long (2,000 characters max).';
  if (d.notes.length > 2000) e.notes = 'Notes can be up to 2,000 characters.';
  if (d.location.length > 200) e.location = 'Keep the location under 200 characters.';
  if (d.endsAt.getTime() < d.startsAt.getTime()) e.time = 'The end needs to be after the start.';
  else if (opts.sending && !opts.editing && d.endsAt.getTime() < now.getTime()) e.time = 'This time has already passed.';
  if (d.respondBy) {
    if (d.respondBy.getTime() > d.startsAt.getTime()) e.respondBy = 'Pick a reply-by time before it starts.';
    else if (opts.sending && d.respondBy.getTime() < now.getTime()) e.respondBy = 'Pick a reply-by time in the future.';
  }
  if (d.links.length > 5) e.links = 'Add up to 5 links.';
  else if (d.links.some((l) => !isLikelyUrl(l))) e.links = 'One of the links doesn’t look right. Start it with https://';
  if (d.invitees && d.invitees.length === 0) e.invitees = 'Choose at least one person.';
  if (d.kind === 'help' && (d.helpersNeeded < 1 || d.helpersNeeded > 20)) e.helpersNeeded = 'Choose between 1 and 20 helpers.';
  return e;
}

export function isLikelyUrl(s: string): boolean {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s.trim());
}

export function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'That email doesn’t look quite right.';
  return null;
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 72) return 'Use 72 characters or fewer.';
  return null;
}

export function validateDisplayName(name: string): string | null {
  const v = name.trim();
  if (!v) return 'Tell us what to call you.';
  if (v.length > 60) return 'Keep it under 60 characters.';
  return null;
}

/** Accepts a full invite link (robin://invite/TOKEN or https://…/invite/TOKEN) or a bare token. */
export function extractInviteToken(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const m = v.match(/invite\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(v)) return v;
  return null;
}

export const MEDIA_RULES = {
  photo: { maxBytes: 20 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'] },
  video: { maxBytes: 200 * 1024 * 1024, maxDurationMs: 180_000, types: ['video/mp4', 'video/quicktime'] },
} as const;

export function guessMime(uri: string, fallback: string | null | undefined, kind: 'photo' | 'video'): string {
  if (fallback && fallback.includes('/')) return fallback.toLowerCase();
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4',
  };
  return (ext && map[ext]) || (kind === 'photo' ? 'image/jpeg' : 'video/mp4');
}

/** Returns a friendly reason a file can't be shared, or null if it's fine. */
export function checkMedia(kind: 'photo' | 'video', mime: string, bytes: number, durationMs?: number | null): string | null {
  if (kind === 'photo') {
    if (!(MEDIA_RULES.photo.types as readonly string[]).includes(mime)) return 'That photo format isn’t supported. Try a JPEG, PNG or HEIC.';
    if (bytes > MEDIA_RULES.photo.maxBytes) return 'That photo is over 20 MB.';
  } else {
    if (!(MEDIA_RULES.video.types as readonly string[]).includes(mime)) return 'That video format isn’t supported. Try an MP4 or MOV.';
    if (bytes > MEDIA_RULES.video.maxBytes) return 'That video is over 200 MB.';
    if (durationMs == null) return 'We couldn’t read how long that video is.';
    if (durationMs > MEDIA_RULES.video.maxDurationMs) return 'Videos can be up to 3 minutes long.';
  }
  if (bytes <= 0) return 'That file looks empty.';
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
