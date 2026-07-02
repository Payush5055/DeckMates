'use client';

import { motion } from 'framer-motion';
import { PlayingCard } from '@/components/table/PlayingCard';
import type { Card } from '@cardadda/shared';

/**
 * A one-time entrance flourish for the game detail page: four cards fly in from
 * off-screen and settle into a small fan beside the title. Decorative only —
 * hidden on mobile where the header is narrow.
 */

const CARDS: { card: Card; x: number; y: number; rot: number }[] = [
  { card: { suit: 'S', rank: 14 }, x: -60, y: 6, rot: -18 },
  { card: { suit: 'H', rank: 14 }, x: -20, y: -2, rot: -6 },
  { card: { suit: 'D', rank: 14 }, x: 20, y: -2, rot: 6 },
  { card: { suit: 'C', rank: 14 }, x: 60, y: 6, rot: 18 },
];

export function DetailCardIntro() {
  return (
    <div className="pointer-events-none absolute right-10 top-1/2 hidden h-24 w-40 -translate-y-1/2 md:block" aria-hidden>
      {CARDS.map((c, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-4 -ml-5"
          initial={{ opacity: 0, x: -260, y: -180, rotate: -50 }}
          animate={{ opacity: 1, x: c.x, y: c.y, rotate: c.rot }}
          transition={{ delay: 0.15 + i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <PlayingCard card={c.card} size="sm" />
        </motion.div>
      ))}
    </div>
  );
}
