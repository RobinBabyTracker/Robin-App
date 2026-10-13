// Maps server error codes (raised by the database functions) and network
// failures to calm, specific messages. Pure: unit tested with Node.

const MESSAGES: Record<string, string> = {
  not_authenticated: 'Please sign in again.',
  not_member: 'You’re no longer part of this family.',
  not_allowed: 'Only a parent in this family can do that.',
  not_found: 'We couldn’t find that. It may have been removed.',
  invalid_name: 'Please check the name.',
  invalid_timezone: 'Please pick a valid time zone.',
  invalid_input: 'Something in that form needs another look.',
  too_many_families: 'You can be in up to 10 families.',
  too_many_invitations: 'There are already 50 open invitations. Cancel some first.',
  invite_invalid: 'That invitation link isn’t valid. Ask for a new one.',
  invite_expired: 'That invitation has expired. Ask for a new link.',
  invite_revoked: 'That invitation was cancelled. Ask for a new link.',
  invite_used: 'That invitation has already been used. Each link works once.',
  invite_declined: 'That invitation was declined. Ask for a new link if you’ve changed your mind.',
  already_member: 'You’re already in this family.',
  last_owner: 'Make someone else an owner first, so the family isn’t left without one.',
  use_leave: 'To remove yourself, choose Leave family.',
  invalid_kind: 'Choose whether this is a request for help or an event.',
  invalid_category: 'Choose what kind of help this is.',
  invalid_title: 'Add a short title.',
  invalid_time: 'The end needs to be after the start.',
  invalid_respond_by: 'Pick a reply-by time before it starts.',
  invalid_helpers: 'Choose between 1 and 20 helpers.',
  invalid_links: 'Add up to 5 links.',
  invalid_invitees: 'Some of the people you chose aren’t in this family any more.',
  no_invitees: 'There’s no one else in this family to ask yet. Invite someone first.',
  in_the_past: 'This time has already passed.',
  not_draft: 'This request has already been sent.',
  version_conflict: 'Someone else changed this while you were editing. We’ve loaded the latest version.',
  task_closed: 'This has been completed or cancelled, so it can’t be changed.',
  response_closed: 'The reply-by time for this request has passed.',
  not_invited: 'This request wasn’t sent to you.',
  helpers_below_accepted: 'More people have already said yes than that.',
  task_not_confirmed: 'This can be marked done once someone has said yes.',
  cannot_change_kind: 'A request can’t be changed into an event. Create a new one instead.',
  no_members: 'Choose at least one person.',
  not_group: 'That only works in group chats.',
  empty_message: 'Type a message or add a photo.',
  message_too_long: 'That message is a bit long (4,000 characters max).',
  too_many_attachments: 'Send up to 10 photos or videos at a time.',
  media_invalid: 'That photo or video isn’t ready yet. Try again.',
  media_type_not_allowed: 'That file type isn’t supported.',
  media_too_large: 'That file is too large.',
  video_too_long: 'Videos can be up to 3 minutes long.',
  upload_missing: 'The upload didn’t finish. Try again.',
  rate_limited: 'That’s a lot of uploads at once. Please wait a little.',
};

export function errorCode(err: unknown): string | null {
  if (!err) return null;
  const msg = typeof err === 'string' ? err : (err as { message?: string }).message ?? '';
  const code = msg.trim().split(/\s/)[0];
  return MESSAGES[code] ? code : null;
}

export function isNetworkError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();
  return msg.includes('network request failed') || msg.includes('failed to fetch') || msg.includes('network error') || msg.includes('timeout');
}

export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isNetworkError(err)) return 'You seem to be offline. Check your connection and try again.';
  const code = errorCode(err);
  if (code) return MESSAGES[code];
  const msg = String((err as { message?: string })?.message ?? '');
  // Supabase Auth messages are already human-readable.
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. We’ve sent you a code.';
  if (/user already registered/i.test(msg)) return 'There’s already an account with that email. Try signing in.';
  if (/token has expired or is invalid/i.test(msg)) return 'That code has expired or isn’t right. Request a new one.';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/permission denied|row-level security/i.test(msg)) return 'You don’t have access to that.';
  return fallback;
}
