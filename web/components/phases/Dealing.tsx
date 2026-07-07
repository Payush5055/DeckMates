'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CardBack } from '@/components/table/CardBack';
import { sound } from '@/lib/audio';
import { CARDS_PER_HAND } from '@cardadda/engine';
import { POS_ANCHOR, POS_ROTATION, type Pos } from '@/lib/seatLayout';

const ALL_POSITIONS: Pos[] = ['bottom', 'left', 'top', 'right'];

interface Flyer {
  id: number;
  pos: Pos;
  dx: number;
  dy: number;
}

/**
 * The one deliberate animated moment: card-backs fly from the exact CENTER of
 * the table out to every seat in a round-robin flurry, with a soft flick per
 * card and each seat's count ticking up. There is no dealer, so cards
 * originate from the middle, not from any one seat.
 *
 * `handSize`/`positions` default to Callbreak's fixed 13-card, 4-seat deal;
 * Crazy 8s passes its own (5 or 7 cards, 2–4 active seats).
 */
export function Dealing({
  onDone,
  handSize = CARDS_PER_HAND,
  positions = ALL_POSITIONS,
}: {
  onDone: () => void;
  handSize?: number;
  positions?: Pos[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState<Record<Pos, number>>({ bottom: 0, left: 0, top: 0, right: 0 });
  const [flyers, setFlyers] = useState<Flyer[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      onDone();
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const target: Record<Pos, { dx: number; dy: number }> = {
      bottom: { dx: 0, dy: height * 0.4 },
      top: { dx: 0, dy: -height * 0.4 },
      left: { dx: -width * 0.4, dy: 0 },
      right: { dx: width * 0.4, dy: 0 },
    };

    let tick = 0;
    let nextId = 0;
    // handSize ticks × ~180ms. Each tick deals one card to every active seat.
    const interval = setInterval(() => {
      tick += 1;
      sound.flick();
      setCounts((c) => {
        const next = { ...c };
        for (const pos of positions) next[pos] = Math.min(handSize, c[pos] + 1);
        return next;
      });

      const batch: Flyer[] = positions.map((pos) => ({ id: nextId++, pos, ...target[pos] }));
      setFlyers((f) => [...f, ...batch]);
      const batchIds = new Set(batch.map((b) => b.id));
      setTimeout(() => setFlyers((f) => f.filter((x) => !batchIds.has(x.id))), 420);

      if (tick >= handSize) {
        clearInterval(interval);
        setTimeout(onDone, 300);
      }
    }, 180);

    return () => clearInterval(interval);
  }, [onDone, handSize, positions]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/2 top-[30%] -translate-x-1/2 font-serif text-xl text-ink/85">Dealing…</div>

      {positions.map((pos) => (
        <div
          key={pos}
          className="tabular absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-rim/85 px-2 py-0.5 text-sm text-gold"
          style={{ left: POS_ANCHOR[pos].left, top: POS_ANCHOR[pos].top }}
        >
          {counts[pos]}
        </div>
      ))}

      {flyers.map((f) => (
        <motion.div
          key={f.id}
          initial={{ x: 0, y: 0, opacity: 0.9, rotate: 0 }}
          animate={{ x: f.dx, y: f.dy, opacity: 1, rotate: POS_ROTATION[f.pos] }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="absolute left-1/2 top-1/2 -ml-5 -mt-7"
        >
          <CardBack size="sm" />
        </motion.div>
      ))}
    </div>
  );
}
