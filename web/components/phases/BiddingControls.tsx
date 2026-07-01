'use client';

import { MAX_BID, MIN_BID } from '@cardadda/engine';

/** The 1–8 bid picker (no nil), shown below the table on your turn to bid. */
export function BiddingControls({
  onBid,
  disabled,
}: {
  onBid: (bid: number) => void;
  disabled: boolean;
}) {
  const options: number[] = [];
  for (let b = MIN_BID; b <= MAX_BID; b++) options.push(b);

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="font-serif text-lg text-ink">How many tricks will you win?</p>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((n) => (
          <button
            key={n}
            disabled={disabled}
            onClick={() => onBid(n)}
            className="tabular h-12 w-12 rounded-lg bg-surface text-lg text-ink ring-1 ring-gold/40 transition hover:bg-gold hover:text-rim disabled:cursor-not-allowed disabled:opacity-40"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
