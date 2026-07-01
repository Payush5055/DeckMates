/**
 * The physical card table: a dark outer rim (#06170F), a thin gold trim ring
 * (#C9A24B), and green felt (#0B2E23) inside — an oval, not a flat rectangle.
 * Children are positioned absolutely against this surface (seats, trick cards).
 */
export function TableSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto aspect-[4/3] w-full max-w-3xl">
      {/* Outer rim */}
      <div className="absolute inset-0 rounded-[50%] bg-rim shadow-table" />
      {/* Gold trim ring */}
      <div className="absolute inset-[3%] rounded-[50%] ring-2 ring-gold/70" />
      {/* Green felt */}
      <div className="felt-texture absolute inset-[4.5%] overflow-hidden rounded-[50%] bg-felt">
        {/* Subtle suit watermark at center */}
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[7rem] text-black/10"
          aria-hidden
        >
          ♠
        </span>
      </div>
      {children}
    </div>
  );
}
