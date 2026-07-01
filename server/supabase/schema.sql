-- CardAdda match history (v1). Apply in the Supabase SQL editor or via CLI.
-- No user accounts yet: history is tied to a browser-persisted player id.

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  played_at timestamptz not null default now(),
  -- Denormalized list of participant player ids for fast "my matches" lookups.
  player_ids text[] not null,
  -- Full per-player standings: [{ playerId, name, seat, totalTenths, rank }].
  players jsonb not null,
  -- Per-round results for optional detail views.
  rounds jsonb not null
);

-- Fast membership queries: "matches containing this player id".
create index if not exists matches_player_ids_idx
  on public.matches using gin (player_ids);

create index if not exists matches_played_at_idx
  on public.matches (played_at desc);
