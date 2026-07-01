const SIZES = {
  sm: 'h-14 w-10',
  md: 'h-20 w-14',
};

/** A face-down card back — deep felt with a gold lattice motif. */
export function CardBack({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div
      className={`rounded-lg border border-gold/40 shadow-card ${SIZES[size]}`}
      style={{
        background:
          'repeating-linear-gradient(45deg, #0F3A2B 0 6px, #0B2E23 6px 12px)',
        boxShadow: 'inset 0 0 0 3px rgba(201,162,75,0.25)',
      }}
      aria-hidden
    />
  );
}
