/** Simple deterministic avatar per seat (no uploads in v1). Shared across games
 * — widened to plain `number` so any game's seat index (0-based) works, not
 * just Callbreak's fixed 0|1|2|3. */
const SEAT_AVATARS = ['🦊', '🐼', '🐧', '🦁'] as const;

export function avatarForSeat(seat: number): string {
  return SEAT_AVATARS[seat] ?? '🎴';
}

/** Clean and bound a user-supplied display name. */
export function sanitizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 20) : '';
  return name.length > 0 ? name : 'Player';
}
