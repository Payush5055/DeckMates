import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono, Playfair_Display } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/authContext';
import { TableProvider } from '@/lib/socketContext';
import { Crazy8Provider } from '@/lib/crazy8SocketContext';
import { ThirtyOneProvider } from '@/lib/thirtyOneSocketContext';
import { TeenPattiProvider } from '@/lib/teenPattiSocketContext';
import { SiteHeader } from '@/components/SiteHeader';

// Characterful serif for headings.
const serif = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
});
// Clean sans for body / UI.
const sans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-sans',
  display: 'swap',
});
// Tabular monospace numerals for scores and bid counts.
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DeckMates — Callbreak',
  description: 'Play Callbreak with friends. A cozy card table, online.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-felt text-ink">
        <AuthProvider>
          <TableProvider>
            <Crazy8Provider>
              <ThirtyOneProvider>
                <TeenPattiProvider>
                  <SiteHeader />
                  {children}
                </TeenPattiProvider>
              </ThirtyOneProvider>
            </Crazy8Provider>
          </TableProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
