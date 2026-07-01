/**
 * Synthesized card sounds via the Web Audio API — no external audio files, so
 * there are no licensing or missing-asset concerns for the MVP. Two moments:
 *   • flick()  — a card-back flying during the deal (repeated, timed to anim).
 *   • place()  — a card set on the felt when anyone plays into a trick.
 *
 * The context is created lazily on the first user gesture (browsers block audio
 * before interaction). A mute flag persists in localStorage.
 */

const MUTE_KEY = 'deckmates:muted';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.muted = window.localStorage.getItem(MUTE_KEY) === '1';
    }
  }

  /** Call from a user-gesture handler (Create/Join click) to unlock audio. */
  init(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();

    // Pre-bake a short white-noise buffer we shape into flicks.
    const seconds = 0.25;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    }
  }

  /** Short, bright noise burst through a band-pass — a card flick. */
  flick(): void {
    this.burst({ freq: 2600, q: 0.9, gain: 0.18, decay: 0.09 });
  }

  /** Lower, slightly softer burst — a card placed on felt. */
  place(): void {
    this.burst({ freq: 1500, q: 1.1, gain: 0.22, decay: 0.13 });
  }

  private burst(opts: { freq: number; q: number; gain: number; decay: number }): void {
    if (this.muted || !this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = opts.freq;
    band.Q.value = opts.q;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(opts.gain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.decay);

    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + opts.decay + 0.02);
  }
}

/** Shared singleton — import and call from anywhere in the client. */
export const sound = new SoundEngine();
