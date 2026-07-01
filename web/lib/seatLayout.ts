/**
 * Maps absolute engine seats (0..3) to on-screen positions relative to the
 * viewer, who always sits at the bottom. Also holds the per-position seat color
 * and trick-card rotation from the spec.
 */

import type { Seat } from '@cardadda/shared';

export type Pos = 'bottom' | 'left' | 'top' | 'right';

const ORDER: Pos[] = ['bottom', 'left', 'top', 'right'];

/** Where `seat` appears on screen given that `you` sit at the bottom. */
export function relativePosition(seat: Seat, you: Seat): Pos {
  const rel = (seat - you + 4) % 4;
  return ORDER[rel]!;
}

/** Seat colors: wine/purple/teal for opponents, gold for "you" (bottom). */
export const POS_COLOR: Record<Pos, string> = {
  bottom: '#C9A24B', // gold — you
  left: '#8B2635', // wine
  top: '#3C3489', // purple
  right: '#0F6E56', // teal
};

/** Trick-card rotation by seat position (deg): top 180, left 90, right -90. */
export const POS_ROTATION: Record<Pos, number> = {
  bottom: 0,
  left: 90,
  top: 180,
  right: -90,
};

/** Absolute anchor for each position inside the oval table (percent). */
export const POS_ANCHOR: Record<Pos, { left: string; top: string }> = {
  bottom: { left: '50%', top: '92%' },
  left: { left: '9%', top: '50%' },
  top: { left: '50%', top: '8%' },
  right: { left: '91%', top: '50%' },
};

/** Where a played card sits in the central cluster, per position (percent). */
export const TRICK_SLOT: Record<Pos, { left: string; top: string }> = {
  bottom: { left: '50%', top: '61%' },
  left: { left: '39%', top: '50%' },
  top: { left: '50%', top: '39%' },
  right: { left: '61%', top: '50%' },
};
