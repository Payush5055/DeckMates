import type { Config } from 'tailwindcss';

/**
 * "Card table" theme tokens from the Milestone 3 spec. Use these names
 * everywhere instead of ad-hoc colors.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: '#0B2E23', // background / table felt
        surface: '#163B2C', // panels
        rim: '#06170F', // table outer rim
        gold: '#C9A24B', // primary accent / CTAs / "you"
        wine: '#8B2635', // secondary accent (used sparingly)
        ink: '#F3EDE0', // primary text
        muted: '#9CA9A0', // secondary text
        seat: {
          wine: '#8B2635',
          purple: '#3C3489',
          teal: '#0F6E56',
          gold: '#C9A24B',
        },
      },
      fontFamily: {
        // Wired to next/font CSS variables in app/layout.tsx.
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        table: '0 30px 60px -15px rgba(0,0,0,0.7)',
        card: '0 4px 10px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};

export default config;
