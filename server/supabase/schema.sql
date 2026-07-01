-- DeckMates database schema. Apply in the Supabase SQL editor (or via the CLI).
-- Two tables: `profiles` (accounts / usernames) and `matches` (completed games).

-- ─────────────────────────────────────────────────────────────────────────────
-- Accounts
--
-- One profile row per authenticated user, holding their chosen username.
-- Sign-in itself is handled by Supabase Auth (the built-in `auth.users` table);
-- this table only adds the app-level username on top of a real user.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive UNIQUE username, enforced at the DATABASE level. This is the
-- real guard against two players taking the same name in a race — the client's
-- live availability check is only a convenience.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Usernames are not secret: any signed-in user may read them (needed for the
-- live availability check and to resolve display names).
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A user may create only their own profile row (id must equal their auth uid).
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- No UPDATE/DELETE policy: usernames are immutable once chosen. The game server
-- uses the service-role key, which bypasses RLS to read usernames when it
-- verifies socket connections.

-- ─────────────────────────────────────────────────────────────────────────────
-- Match history
--
-- One row per completed 5-round match, written by the server on game over.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  played_at timestamptz not null default now(),
  -- Participant identities. For real players these are the authenticated user
  -- ids (== profiles.id == auth.users.id). In dev/bot play they are synthetic
  -- ids like 'dev-ann' or 'bot-1' that have NO auth.users row — which is why
  -- this is a plain text[] with no foreign key (Postgres also cannot FK
  -- individual array elements). Denormalized for fast "my matches" lookups.
  player_ids text[] not null,
  -- Full per-player standings: [{ playerId, name, seat, totalTenths, rank }].
  players jsonb not null,
  -- Per-round results for optional detail views.
  rounds jsonb not null
);

-- Fast membership queries: "matches containing this user id".
create index if not exists matches_player_ids_idx
  on public.matches using gin (player_ids);

create index if not exists matches_played_at_idx
  on public.matches (played_at desc);

-- Match rows are written by the server with the service-role key, and the
-- /history API also reads them through the server — so RLS is not required for
-- the current flow. If you ever query `matches` directly from the browser with
-- the anon key, enable RLS and restrict reads to a user's own matches:
--
--   alter table public.matches enable row level security;
--   create policy "read own matches" on public.matches for select to authenticated
--     using (auth.uid()::text = any (player_ids));
