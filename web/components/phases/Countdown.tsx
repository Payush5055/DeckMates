'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * On-table countdown shown the instant the 4th player joins (and before each
 * round's deal). Counts N → 1, one number per second, then calls onDone.
 */
export function Countdown({ seconds = 3, onDone }: { seconds?: number; onDone: () => void }) {
  const [n, setN] = useState(seconds);

  useEffect(() => {
    if (n <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setN((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [n, onDone]);

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
      <p className="font-serif text-lg text-ink/80">Starting in</p>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={n}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="tabular text-7xl font-bold text-gold"
        >
          {n}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
