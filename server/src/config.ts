import 'dotenv/config';

/** Runtime configuration, read once from the environment with safe defaults. */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** Seat-hold window for a dropped player (brief requires 60s). */
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 60_000),
  /** How long the round-result screen shows before the next deal. */
  roundEndDelayMs: Number(process.env.ROUND_END_DELAY_MS ?? 4_000),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};

/** True when Supabase credentials are present; otherwise we use in-memory. */
export function hasSupabase(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}
