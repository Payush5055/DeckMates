/**
 * Signature motif: suit pips as a structural divider (not literal card art).
 * Used to break up sections and as a hero watermark accent.
 */
export function SuitDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 text-gold/70 ${className}`}>
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-gold/40" />
      <span className="text-sm tracking-[0.3em]" aria-hidden>
        ♠ ♥ ♦ ♣
      </span>
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-gold/40" />
    </div>
  );
}

/** A single pip used as a bullet in rules lists. */
export function SuitBullet({ suit = '♠', className = '' }: { suit?: string; className?: string }) {
  return (
    <span className={`mr-2 inline-block text-gold ${className}`} aria-hidden>
      {suit}
    </span>
  );
}
