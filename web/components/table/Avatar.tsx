/**
 * A seat is represented by a colored circular avatar with a simple person icon.
 * Per the spec, NO player name text appears at the table — only color + icon.
 * An optional badge shows the live "tricks / bid" counter.
 */

interface Props {
  color: string;
  size?: number;
  connected?: boolean;
  active?: boolean; // highlight when it's this seat's turn
  badge?: string; // e.g. "2/5"
}

export function Avatar({ color, size = 56, connected = true, active = false, badge }: Props) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative flex items-center justify-center rounded-full shadow-card transition ${
          active ? 'ring-4 ring-gold ring-offset-2 ring-offset-felt' : 'ring-2 ring-black/30'
        } ${connected ? '' : 'opacity-45 grayscale'}`}
        style={{ width: size, height: size, backgroundColor: color }}
      >
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="#F3EDE0" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8Z" />
        </svg>
        {!connected && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-rim px-1.5 py-0.5 text-[9px] text-muted">
            reconnecting…
          </span>
        )}
      </div>
      {badge !== undefined && (
        <span className="tabular rounded-md bg-rim/80 px-2 py-0.5 text-sm text-ink shadow-card">{badge}</span>
      )}
    </div>
  );
}
