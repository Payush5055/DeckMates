/**
 * A seat is a colored circular avatar with an icon, plus the player's username
 * (or "Bot") as a text label beneath it. Bots use a distinct robot icon so it's
 * clear which seats are computer-controlled. An optional badge shows the live
 * "tricks / bid" counter (or bid-submitted status during blind bidding).
 */

interface Props {
  color: string;
  size?: number;
  connected?: boolean;
  active?: boolean; // highlight when it's this seat's turn
  label?: string; // username, or "Bot"
  isBot?: boolean;
  isYou?: boolean;
  turnLabel?: string; // e.g. "Your turn" / "Playing…" shown when active
  badge?: string; // e.g. "2/5"
}

function PersonIcon({ size }: { size: number }) {
  return (
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="#F3EDE0" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8Z" />
    </svg>
  );
}

function BotIcon({ size }: { size: number }) {
  return (
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="#F3EDE0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v2.5" />
      <circle cx="12" cy="3" r="0.9" fill="#F3EDE0" stroke="none" />
      <rect x="4.5" y="6" width="15" height="12" rx="3" />
      <circle cx="9" cy="12" r="1.4" fill="#F3EDE0" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="#F3EDE0" stroke="none" />
      <path d="M2.5 11v3M21.5 11v3" />
    </svg>
  );
}

export function Avatar({
  color,
  size = 56,
  connected = true,
  active = false,
  label,
  isBot = false,
  isYou = false,
  turnLabel,
  badge,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative flex items-center justify-center rounded-full shadow-card transition ${
          active ? 'ring-4 ring-gold ring-offset-2 ring-offset-felt' : 'ring-2 ring-black/30'
        } ${connected ? '' : 'opacity-45 grayscale'}`}
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          // A gold glow makes the active seat obvious at a glance.
          boxShadow: active ? '0 0 20px 3px rgba(201,162,75,0.75)' : undefined,
        }}
      >
        {isBot ? <BotIcon size={size} /> : <PersonIcon size={size} />}
        {!connected && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-rim px-1.5 py-0.5 text-[9px] text-muted">
            reconnecting…
          </span>
        )}
      </div>
      {label && (
        <span className="max-w-[6rem] truncate text-xs font-medium text-ink/90" title={label}>
          {label}
        </span>
      )}
      {active && turnLabel && (
        <span
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-card ${
            isYou ? 'bg-gold text-rim' : 'bg-rim/80 text-gold ring-1 ring-gold/40'
          }`}
        >
          {turnLabel}
        </span>
      )}
      {badge !== undefined && (
        <span className="tabular rounded-md bg-rim/80 px-2 py-0.5 text-sm text-ink shadow-card">{badge}</span>
      )}
    </div>
  );
}
