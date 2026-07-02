import 'dotenv/config';

/** Runtime configuration, read once from the environment with safe defaults. */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** Seat-hold window for a dropped player (brief requires 60s). */
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 60_000),
  /** How long the round-result screen shows before the next deal. */
  roundEndDelayMs: Number(process.env.ROUND_END_DELAY_MS ?? 4_000),
  /**
   * How long the completed trick (all 4 cards face-up) stays on the table
   * before it's resolved and cleared. Without this hold, the 4th card would
   * never be visible to clients.
   */
  trickHoldMs: Number(process.env.TRICK_HOLD_MS ?? 700),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  /**
   * Dev-only auth bypass. When '1'/'true', the server accepts `dev:<username>`
   * handshake tokens (deriving a stable fake user id). MUST be off in prod.
   */
  devAuth: /^(1|true)$/i.test(process.env.DEV_AUTH ?? ''),
};

/** True when Supabase credentials are present; otherwise we use in-memory. */
export function hasSupabase(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}
