# DeckMates — Auth setup (Google OAuth via Supabase)

Accounts are required to play. Sign-in is Google OAuth handled by Supabase Auth.
Until you complete the steps below, run on the **dev bypass** (`DEV_AUTH=1` /
`NEXT_PUBLIC_DEV_AUTH=1`) — a "play as test user" login that needs no Google
setup. Open several browser tabs with different usernames to fill a table.

The Google Cloud + Supabase steps below can only be done by you (they create
secrets tied to your accounts). Claude can't do them for you.

---

## 1. Create a Supabase project

1. Go to https://supabase.com → **New project**. Note the project **URL** and
   keys under **Project Settings → API**:
   - `anon` public key → web `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → server `SUPABASE_SERVICE_ROLE_KEY`
   - Project URL → both `NEXT_PUBLIC_SUPABASE_URL` (web) and `SUPABASE_URL` (server)
2. In the **SQL editor**, run `server/supabase/schema.sql` — it creates both the
   `profiles` (accounts/usernames) and `matches` (history) tables.

## 2. Create a Google OAuth client

1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → fill app name,
   support email, developer email → save. Add your Google account as a **test
   user** while in "Testing".
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   type **Web application**.
4. Under **Authorized redirect URIs**, add the callback Supabase shows you in
   the next step — it looks like:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Save. Copy the **Client ID** and **Client secret**.

## 3. Wire Google into Supabase

1. Supabase → **Authentication → Providers → Google** → enable.
2. Paste the Google **Client ID** and **Client secret** → save.
3. Supabase → **Authentication → URL Configuration** → set **Site URL** to your
   web origin (e.g. `http://localhost:3000` for local) and add it to
   **Redirect URLs** (e.g. `http://localhost:3000/login`).

## 4. Fill env files

`web/.env.local`:

```
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_DEV_AUTH=0
```

`server/.env`:

```
PORT=4000
CORS_ORIGIN=http://localhost:3000
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
DEV_AUTH=0
```

Restart both servers. The `/login` page now shows **Continue with Google**; on
first sign-in you'll pick a unique username (stored in `profiles`), then you can
create/join tables. `/history` and match records key off the Supabase user id.

## How identity is verified (for reference)

- The browser sends its Supabase **access token** in the Socket.io handshake and
  in the `Authorization: Bearer` header for `/api/history`.
- The server validates the token with Supabase (`auth.getUser`) to get the real
  user id, then reads the username from `profiles` (service role). Clients never
  send their own id/username — see `server/src/auth.ts`.
