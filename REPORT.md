# Robin: implementation report (13 October 2026)

**Status: not production-ready.** The database rules and data layer are tested; the app compiles and bundles for Android and iOS, but it has not yet run on a device or against a live Supabase project. Treat it as a complete first build that now needs real-world testing.

## Fully implemented (and tested at the database/API level)

- **Accounts:** sign up, sign in (password or emailed 6-digit code), password reset by code, sign out, profile name and time zone. A profile is created automatically, and nothing about children is collected.
- **Family groups:** create a family; owner, parent and helper roles; rename the family; change roles (owners only); remove members (owners remove parents and helpers, parents remove helpers, nobody removes an owner); leave a family. The last owner can't leave a family that still has other members. A sole member leaving deletes the family.
- **Invitations:** one-time links that expire after 1 hour to 14 days. Only a SHA-256 hash of each token is stored, and the token can't be read back. Invitations can be revoked and declined, and each link works once. The link previews who invited you before you join. An invite opened before sign-up is held until you finish signing up.
- **Requests and events:**
  - Parents can create, draft, send, edit, cancel and complete them.
  - Each one supports a category, title, details, location, notes, links, all-day or timed slots, reply-by times, everyone or chosen people, and how many helpers are needed.
  - Edits are guarded by a version number.
  - Submitting twice is harmless because of a client ID.
- **Atomic assignment:** `respond_to_task` locks the task row (`SELECT … FOR UPDATE`), so the first acceptance the server processes wins. Everyone else gets an accurate "already covered" result and a notification. Helpers can withdraw, which reopens the task. Declines are visible only to the person who asked.
- **Group events:** going, maybe or can't for each invitee, an attendance list, edit and cancel. Changes and cancellations notify everyone who hasn't declined.
- **Calendar:**
  - The calendar is one database function, so an item can't appear twice.
  - Week and month views, with Mine or Whole family, Requests or Events, and Show cancelled filters.
  - All times are stored in UTC and shown in each person's own time zone.
  - All-day items keep their dates across time zones.
  - When an item was planned in another zone, a hint shows its original time.
- **Messaging:**
  - Direct chats are reused, never duplicated; groups can be named, renamed, added to and left.
  - Text messages and up to 10 photos or videos per message.
  - Message history loads 30 at a time; the app shows unread counts, Delivered and Read states, and lets people delete their own messages, mute a chat and see its shared media.
  - Retrying a send never creates a duplicate, and an unsent message shows "Not sent · Tap to retry".
- **Media and memories:**
  - Uploads accept photos (JPEG, PNG, HEIC or WebP, up to 20 MB) and videos (MP4 or MOV, up to 200 MB and 3 minutes).
  - Upload flow: reserve a path, upload with progress, then the server confirms the file arrived. Failed uploads can be retried.
  - The storage bucket is private. Files open only through signed links that expire, and only if the database says you may see that exact file, so guessing a URL or changing an ID gets nothing.
  - Memories show in a gallery by month, with captions, dates, a link back to the original chat or event, and a parents-only option.
  - Deleting a memory makes its file unreadable straight away.
- **Notifications:** a persistent in-app notification centre covering requests, acceptances, filled tasks, withdrawals, changes, cancellations, replies, new members, messages and reminders.
  - Duplicates are prevented: each chat has one notification row that refreshes.
  - Read and unread states, Mark all as read, and per-category preferences, which are enforced on the server.
- **Live updates:** Supabase Realtime subscriptions refresh the calendar, tasks, chats, notifications, members and memories. Realtime applies the same access rules.
- **Account deletion:**
  - Removes your uploads and hands ownership of a family to the next parent.
  - Cancels requests you organised that haven't happened yet.
  - Your old messages show as "Former member".
  - It's tested in the database; the edge function that runs it is untested (see below).

## Partially implemented

- **Google sign-in:** the code is written but untested. It needs Google OAuth credentials.
- **Push notifications:** device registration, the `send-push` function (which respects push on/off, quiet hours and already-read items) and tap-to-open are written. They're untested end-to-end and need EAS and Firebase setup. The in-app centre works without push.
- **Edge functions** (`delete-account`, `send-push`, `cleanup-media`): typechecked with Deno, and the quiet-hours logic is unit tested. They haven't been deployed or run.
- **Reminders:** a 2-hour reminder, plus a "no one is free yet" note when a reply-by time passes. This needs `pg_cron` enabled. The timing is fixed, not configurable.
- **Offline:** network failures show clear messages and retry buttons, and failed sends and uploads can be retried. There's no offline cache or queue across app restarts.
- **Quiet hours:** supported by the database and the push function, but there's no screen to set them yet.

## Not implemented (outside this build, or needs your decision)

- Gentle nudges to people who haven't helped recently. These are optional in the brief; the `last_helped_at` data needed for them is already recorded.
- Sign in with Apple. It's needed before an iPhone release if Google sign-in is offered.
- Profile photos. The field exists, but there's no upload screen.
- Removing people who were already asked to an event. Editing can only add people.
- Universal https invite links. `robin://` links only open on phones with Robin installed; https links need a website domain.
- A tablet or desktop layout. The phone layout simply stretches.

## External services and credentials still needed

1. A Supabase project: URL, publishable key, and the service role key (edge functions only).
2. Supabase email templates changed to send 6-digit codes. See the README.
3. Google Cloud OAuth client, for Google sign-in.
4. An EAS project ID, plus Firebase Cloud Messaging credentials for Android push.
5. A Google Play developer account, and an Apple developer account later for iPhone.
6. Licences that allow embedding Ethic Serif and Questa in an app. Stand-in fonts are used until then.

## Known limitations

- Each signed media link lasts up to an hour, so someone removed from a family could still open a link they had already loaded until it expires. Their access to new links stops immediately.
- The server trusts the device's reported video length. File size is enforced by storage itself.
- One caption applies to every photo in a batch added to Memories.
- Chat search covers chat names and last messages, not full message history.
- Notification preferences are per person, not per family.

## Tests performed

All of the following ran on 13 October 2026 and passed.

| Suite | What it covers | Result |
|---|---|---|
| TypeScript (`tsc --noEmit`) | the whole app | clean |
| Unit tests (13) | time-zone conversion across daylight saving, all-day dates for viewers in other zones, calendar grids, form validation, invite link parsing, media rules, error messages | 13/13 pass |
| Database tests (44), on real Postgres 16 with the actual migrations | see the list below | 44/44 pass |
| API test, through PostgREST (real HTTP, JWT roles) | the app's own data functions end to end: invites, request, concurrent accept, 35-message pagination, unread and read, media in chat, memories, preferences, anonymous access refused | pass |
| Deno | edge functions typecheck; quiet-hours unit test | pass |
| Bundling | `expo export` for Android and iOS | both bundle |

The database tests cover:

- Outsiders seeing nothing.
- Blocking direct table writes.
- Invitation reuse, expiry, revoking and declining.
- Unreadable token hashes.
- Role permissions.
- Removed members losing access to the family, chats, files and memories.
- The last-owner rule.
- Validation.
- Double-submit, which creates exactly one task.
- Drafts staying private.
- **Concurrent acceptance:** 8 people accepting at once, 5 rounds, exactly 1 winner every time. With 2 helpers needed and 6 people accepting, exactly 2 win.
- Withdrawal.
- Declines staying private.
- Reply-by enforcement.
- Event replies, edit conflicts and change and cancellation notifications.
- No calendar duplicates.
- Direct-chat de-duplication.
- Message retries.
- Unread counts and mute.
- Preferences being honoured.
- Upload type, size and length rules.
- Uploads only going to reserved paths.
- Per-chat media privacy.
- Parents-only memories.
- Deleted and removed access to files.
- Account deletion.
- Media cleanup.
- Server-only functions refusing users.
- Reminders being sent once.

To check the race test is meaningful, I removed the row lock and ran it again. It caught 6 winners instead of 1. I then restored the lock.

**Failures found and fixed during testing:**

- Two notification calls passed arguments in the wrong order.
- Deleted files couldn't be removed from storage, because storage deletes also need read access.
- A deleted account's memories stayed visible.
- Media cleanup could remove an upload that was still in progress.
- Events marked "maybe" dropped out of Coming up.

**Not yet tested:** the app on a real phone or with a screen reader, against live Supabase Auth, Storage and Realtime, Google sign-in, push delivery, and the deployed edge functions. These are the next steps before calling Robin ready for families.
