/**
 * Faint, slowly-drifting suit glyphs scattered across the full page width — a
 * subtle background texture that fills the empty side-margins on wide desktop
 * viewports. Hidden below `lg` (mobile already fills the width). Purely
 * decorative and non-interactive; sits behind content.
 */

interface Pip {
  suit: string;
  left: string;
  top: string;
  size: string;
  dur: string;
  delay: string;
  tone: 'gold' | 'ink';
}

const PIPS: Pip[] = [
  { suit: '♠', left: '3%', top: '16%', size: '7rem', dur: '26s', delay: '0s', tone: 'gold' },
  { suit: '♥', left: '11%', top: '62%', size: '5rem', dur: '22s', delay: '3s', tone: 'ink' },
  { suit: '♦', left: '20%', top: '32%', size: '4rem', dur: '30s', delay: '1s', tone: 'ink' },
  { suit: '♣', left: '32%', top: '78%', size: '6rem', dur: '25s', delay: '5s', tone: 'gold' },
  { suit: '♠', left: '50%', top: '10%', size: '4.5rem', dur: '28s', delay: '2s', tone: 'ink' },
  { suit: '♦', left: '67%', top: '72%', size: '5.5rem', dur: '24s', delay: '4s', tone: 'gold' },
  { suit: '♥', left: '79%', top: '28%', size: '6rem', dur: '27s', delay: '1.5s', tone: 'ink' },
  { suit: '♣', left: '88%', top: '58%', size: '4.5rem', dur: '23s', delay: '6s', tone: 'ink' },
  { suit: '♠', left: '95%', top: '20%', size: '7rem', dur: '29s', delay: '2.5s', tone: 'gold' },
];

export function AmbientPips() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 hidden overflow-hidden lg:block" aria-hidden>
      {PIPS.map((p, i) => (
        <span
          key={i}
          className="ambient-pip absolute select-none leading-none"
          style={{
            left: p.left,
            top: p.top,
            fontSize: p.size,
            animationDuration: p.dur,
            animationDelay: p.delay,
            color: p.tone === 'gold' ? 'rgba(201,162,75,0.06)' : 'rgba(243,237,224,0.05)',
          }}
        >
          {p.suit}
        </span>
      ))}
    </div>
  );
}
