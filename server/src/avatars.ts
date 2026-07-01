import type { Seat } from '@cardadda/engine';

/** Simple deterministic avatar per seat (no uploads in v1). */
const SEAT_AVATARS = ['🦊', '🐼', '🐧', '🦁'] as const;

export function avatarForSeat(seat: Seat): string {
  return SEAT_AVATARS[seat] ?? '🎴';
}

/** Clean and bound a user-supplied display name. */
export function sanitizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 20) : '';
  return name.length > 0 ? name : 'Player';
}
