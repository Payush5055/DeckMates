'use client';

import { useState } from 'react';
import { sound } from '@/lib/audio';

/** Small speaker icon that toggles all synthesized sounds. */
export function MuteToggle() {
  const [muted, setMuted] = useState(sound.muted);

  return (
    <button
      onClick={() => {
        const next = !muted;
        sound.setMuted(next);
        setMuted(next);
      }}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      title={muted ? 'Unmute' : 'Mute'}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink/80 ring-1 ring-ink/20 transition hover:text-gold hover:ring-gold/50"
    >
      {muted ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
    </button>
  );
}
