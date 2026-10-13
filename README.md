# Robin

Your family's handy helper. An Expo (React Native) app for Android and iOS, backed by Supabase (Postgres, Auth, Storage, Realtime, Edge Functions).

```
src/app/            screens (Expo Router)
src/components/     task form, media, header, etc.
src/ui/             design tokens, shared components, icons, Robin artwork
src/lib/            data access (api.ts), time zones, validation, uploads, push
src/state/          sign-in, current family, queries, live updates
supabase/migrations database schema, access rules and server functions
supabase/functions  edge functions: delete-account, send-push, cleanup-media
supabase/tests      database + API tests
scripts/            demo data seeding (development projects only)
```

## 1. Connect Supabase

1. Create a project at supabase.com (the free plan is fine to start).
2. **Database → Extensions**: enable `pg_cron` and `pg_net` first (so the reminder schedule is created), then apply the database:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```
3. **Authentication → Providers → Email**: keep "Confirm email" on.
4. **Authentication → Email Templates**: Robin uses 6-digit codes rather than links. In *Confirm signup*, *Magic Link* and *Reset Password*, include the code, e.g. `Your Robin code is {{ .Token }}`.
5. **Authentication → URL Configuration**: add `robin://auth-callback` to Redirect URLs.
6. **Google sign-in** (optional): create an OAuth client in Google Cloud, then enable the Google provider in Supabase with its client ID and secret.
7. Copy `.env.example` to `.env` and fill in your project URL and **publishable (anon) key**. Never put the service role key in the app.

### Scheduled jobs and push
8. Deploy the edge functions and set a shared secret:
   ```bash
   npx supabase secrets set ROBIN_FUNCTION_SECRET="$(openssl rand -hex 32)"
   npx supabase functions deploy delete-account send-push cleanup-media
   ```
9. **Database → Webhooks**: create a webhook on `public.notifications` for **Insert and Update**, calling the `send-push` function, with header `x-robin-secret: <your secret>`.
10. Schedule `cleanup-media` daily (Edge Functions → Schedules, or `pg_cron` + `net.http_post`), with the same header.
11. Push to phones also needs an EAS project (`npx eas-cli init`, which fills `extra.eas.projectId` in `app.json`) and, for Android, Firebase Cloud Messaging credentials uploaded with `npx eas-cli credentials`.

## 2. Run the app

```bash
npm install
npx expo start
```

Use a **development build** (`npx eas-cli build --profile development --platform android`) for push notifications; Expo Go doesn't support remote push on Android.

## 3. Brand fonts

Ethic Serif and Questa need licences that allow embedding in an app. Until those files are added, DM Serif Display and Source Serif 4 stand in. To switch, add the font files under `assets/fonts/` and change the `Heading` and `Voice` entries in `src/app/_layout.tsx` to `require('../../assets/fonts/…')`.

## 4. Demo data (development projects only)

```bash
ROBIN_ALLOW_DEMO=1 SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… npm run seed:demo
```
Creates a family called "Demo · The Parkers" with `@demo.invalid` accounts. Never run it against your live project.

## 5. Tests

```bash
npm run typecheck     # TypeScript
npm run test:unit     # time zones, validation, error messages
npm run test:db       # database rules on Postgres 16 (needs a local Postgres on port 54322)
npm run test:api      # the app's data layer through PostgREST (needs the postgrest binary)
```
The database tests run the real migrations against Postgres with a small imitation of Supabase's auth and storage schemas (`supabase/tests/supabase_stubs.sql`). They are not a substitute for testing on a real Supabase project.
