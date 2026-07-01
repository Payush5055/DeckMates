/** Scores travel as integer tenths; display as a single-decimal number. */
export function formatTenths(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/** Same, but with an explicit sign for round deltas (e.g. "+3.2", "-3.0"). */
export function formatSignedTenths(tenths: number): string {
  const s = (tenths / 10).toFixed(1);
  return tenths > 0 ? `+${s}` : s;
}

/** Ordinal placement label: 1 → "1st", 2 → "2nd", … */
export function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}
