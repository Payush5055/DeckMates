'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/authContext';
import { sound } from '@/lib/audio';
import { Button } from '@/components/ui/Button';
import { SuitDivider } from '@/components/ui/SuitDivider';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const {
    ready,
    user,
    needsUsername,
    supabaseEnabled,
    devEnabled,
    signInWithGoogle,
    signInAsDev,
  } = useAuth();

  // Fully signed in (has username) → leave the login page.
  useEffect(() => {
    if (ready && user && !needsUsername) router.replace(next);
  }, [ready, user, needsUsername, next, router]);

  if (!ready) return <Centered>Loading…</Centered>;

  if (user && needsUsername) {
    return (
      <Centered>
        <UsernamePicker />
      </Centered>
    );
  }

  // Signed out → offer sign-in methods.
  return (
    <Centered>
      <h1 className="font-serif text-3xl text-ink">Welcome to DeckMates</h1>
      <p className="mt-1 text-sm text-muted">Sign in to take a seat at the table.</p>
      <SuitDivider className="my-6" />

      {supabaseEnabled && (
        <Button
          className="w-full"
          onClick={() => {
            sound.init();
            void signInWithGoogle();
          }}
        >
          Continue with Google
        </Button>
      )}

      {devEnabled && (
        <>
          {supabaseEnabled && <div className="my-4 text-center text-xs text-muted">or, for local testing</div>}
          <DevSignIn onSubmit={(name) => { sound.init(); signInAsDev(name); }} />
        </>
      )}

      {!supabaseEnabled && !devEnabled && (
        <p className="text-sm text-wine">
          Auth isn’t configured. Set Supabase keys or enable dev auth to sign in.
        </p>
      )}
    </Centered>
  );
}

function DevSignIn({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
      className="flex flex-col gap-3"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={20}
        placeholder="Test username"
        className="rounded-xl bg-rim/60 px-4 py-3 text-ink outline-none ring-1 ring-ink/20 focus:ring-gold/60"
      />
      <Button type="submit" variant="ghost" disabled={!name.trim()}>
        Enter as test user
      </Button>
      <p className="text-center text-xs text-muted">
        Dev only — open multiple tabs with different names to fill a table.
      </p>
    </form>
  );
}

/** First-sign-in username selection with a live availability check. */
function UsernamePicker() {
  const { chooseUsername, isUsernameAvailable, signOut } = useAuth();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'short'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setStatus('idle');
      return;
    }
    if (trimmed.length < 3) {
      setStatus('short');
      return;
    }
    setStatus('checking');
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const available = await isUsernameAvailable(trimmed);
      if (mine === seq.current) setStatus(available ? 'available' : 'taken');
    }, 350);
    return () => clearTimeout(t);
  }, [name, isUsernameAvailable]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== 'available' && status !== 'idle') return;
    setSubmitting(true);
    setError(null);
    const res = await chooseUsername(name.trim());
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not set username');
      setStatus('taken');
    }
    // On success, AuthProvider clears needsUsername and the page redirects.
  }

  return (
    <>
      <h1 className="font-serif text-2xl text-ink">Choose your username</h1>
      <p className="mt-1 text-sm text-muted">This is unique and can’t be changed later.</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="username"
          className="rounded-xl bg-rim/60 px-4 py-3 text-ink outline-none ring-1 ring-ink/20 focus:ring-gold/60"
        />
        <div className="h-5 text-sm">
          {status === 'checking' && <span className="text-muted">Checking…</span>}
          {status === 'available' && <span className="text-emerald-300">Available ✓</span>}
          {status === 'taken' && <span className="text-wine">Taken — try another</span>}
          {status === 'short' && <span className="text-muted">At least 3 characters</span>}
        </div>
        <Button type="submit" disabled={submitting || status === 'checking' || status === 'taken' || status === 'short' || name.trim().length < 3}>
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
        {error && <p className="text-sm text-wine">{error}</p>}
      </form>
      <button onClick={() => void signOut()} className="mt-4 text-xs text-muted hover:text-ink">
        Sign out
      </button>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-7 text-center shadow-table ring-1 ring-gold/20">
        <Link href="/" className="mb-4 inline-block font-serif text-xl text-gold">
          DeckMates
        </Link>
        <div className="text-left">{children}</div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <LoginInner />
    </Suspense>
  );
}
