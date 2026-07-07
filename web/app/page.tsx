import Link from 'next/link';
import { SuitDivider } from '@/components/ui/SuitDivider';
import { AmbientPips } from '@/components/ui/AmbientPips';

/** Netflix-style browse: hero + a row of game cards (only Callbreak is live). */

interface GameCard {
  slug: string;
  title: string;
  tag: string;
  live: boolean;
}

const GAMES: GameCard[] = [
  { slug: 'callbreak', title: 'Callbreak', tag: '4 players · Trick-taking', live: true },
  { slug: 'crazy8s', title: 'Crazy 8s', tag: '2–4 players · Match & go wild', live: true },
  { slug: 'rummy', title: 'Rummy', tag: 'Coming soon', live: false },
  { slug: 'teen-patti', title: 'Teen Patti', tag: 'Coming soon', live: false },
  { slug: 'hearts', title: 'Hearts', tag: 'Coming soon', live: false },
];

export default function HomePage() {
  return (
    <>
      <AmbientPips />
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
      {/* Hero (global header + sign-in state come from the root layout) */}
      <section className="relative overflow-hidden rounded-3xl bg-surface px-8 py-16 shadow-table ring-1 ring-gold/20">
        <span className="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 select-none text-[16rem] leading-none text-black/15" aria-hidden>
          ♠
        </span>
        <div className="relative max-w-xl">
          <p className="text-sm uppercase tracking-[0.3em] text-gold/80">The card table, online</p>
          <h1 className="mt-3 font-serif text-5xl leading-tight text-ink">
            Gather your mates.<br />Deal the cards.
          </h1>
          <p className="mt-4 text-muted">
            Real-time Callbreak for four. Sign in, share a room code, and take your seat at the felt.
          </p>
          <Link
            href="/game/callbreak"
            className="mt-7 inline-flex rounded-xl bg-gold px-7 py-3 font-medium text-rim transition hover:brightness-110"
          >
            Play now
          </Link>
        </div>
      </section>

      <SuitDivider className="my-10" />

      {/* Games row */}
      <section>
        <h2 className="mb-4 font-serif text-xl text-ink">Games</h2>
        <div className="no-scrollbar flex gap-4 overflow-x-auto pb-3">
          {GAMES.map((g) =>
            g.live ? (
              <Link
                key={g.slug}
                href={`/game/${g.slug}`}
                className="group relative flex h-52 w-40 shrink-0 flex-col justify-end overflow-hidden rounded-2xl bg-felt p-4 shadow-card ring-1 ring-gold/40 transition hover:ring-gold"
              >
                <span className="pointer-events-none absolute right-2 top-3 text-6xl text-gold/25 transition group-hover:text-gold/40" aria-hidden>
                  ♠
                </span>
                <span className="relative font-serif text-xl text-ink">{g.title}</span>
                <span className="relative text-xs text-muted">{g.tag}</span>
              </Link>
            ) : (
              <div
                key={g.slug}
                aria-disabled
                className="relative flex h-52 w-40 shrink-0 cursor-not-allowed flex-col justify-end overflow-hidden rounded-2xl bg-rim/50 p-4 opacity-50 ring-1 ring-ink/10"
              >
                <span className="pointer-events-none absolute right-2 top-3 text-6xl text-ink/10" aria-hidden>
                  ♣
                </span>
                <span className="relative font-serif text-xl text-muted">{g.title}</span>
                <span className="relative text-xs text-muted">{g.tag}</span>
              </div>
            ),
          )}
        </div>
      </section>
      </main>
    </>
  );
}
