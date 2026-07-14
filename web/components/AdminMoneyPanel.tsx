'use client';

/**
 * Admin-only panel on the account page: search any account by its unique
 * username and credit money to it (including the admin's own account).
 *
 * Rendering is gated on the `isAdmin` flag from /api/wallet, but that flag is
 * cosmetic — the server independently re-verifies the admin's identity (from
 * the bearer token, against ADMIN_USERNAMES) on every /api/admin/* request,
 * so a non-admin poking at this UI or the endpoints directly gets a 403.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

interface FoundUser {
  username: string;
  balance: number;
}

export function AdminMoneyPanel({ token }: { token: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FoundUser | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Debounced username search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`${SOCKET_URL}/api/admin/users?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data: { users?: FoundUser[] }) => setResults(data.users ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, token]);

  async function addMoney() {
    if (!selected) return;
    const value = Number(amount);
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${SOCKET_URL}/api/admin/add-money`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: selected.username, amount: value }),
      });
      const data = (await res.json()) as { username?: string; newBalance?: number; error?: string };
      if (!res.ok || data.newBalance === undefined) {
        setNotice({ kind: 'err', text: data.error ?? 'Something went wrong' });
        return;
      }
      setNotice({
        kind: 'ok',
        text: `Added ₹${value.toLocaleString('en-IN')} to ${data.username} — new balance ₹${data.newBalance.toLocaleString('en-IN')}`,
      });
      setSelected({ username: data.username!, balance: data.newBalance });
      setResults((prev) =>
        prev?.map((u) => (u.username === data.username ? { ...u, balance: data.newBalance! } : u)) ?? null,
      );
      setAmount('');
    } catch {
      setNotice({ kind: 'err', text: 'Could not reach the game server.' });
    } finally {
      setBusy(false);
    }
  }

  const amountValid = Number.isInteger(Number(amount)) && Number(amount) > 0;

  return (
    <section className="mt-10 rounded-2xl bg-surface p-6 ring-1 ring-gold/25">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-gold/20 px-2 py-0.5 text-xs uppercase tracking-widest text-gold">Admin</span>
        <h2 className="font-serif text-xl text-ink">Add money to an account</h2>
      </div>
      <p className="mt-1 text-sm text-muted">
        Search a unique username, pick the account, and credit any amount — yours included.
      </p>

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
          setNotice(null);
        }}
        placeholder="Search username…"
        className="mt-4 w-full rounded-xl bg-rim/60 px-4 py-3 text-ink outline-none ring-1 ring-ink/20 focus:ring-gold/60"
      />

      {searching && <p className="mt-2 text-xs text-muted">Searching…</p>}
      {!searching && results !== null && results.length === 0 && (
        <p className="mt-2 text-xs text-muted">No account matches “{query.trim()}”.</p>
      )}

      {!!results?.length && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {results.map((u) => (
            <li key={u.username}>
              <button
                onClick={() => {
                  setSelected(u);
                  setNotice(null);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left transition ${
                  selected?.username === u.username
                    ? 'bg-gold/15 ring-1 ring-gold/50'
                    : 'bg-rim/40 ring-1 ring-ink/10 hover:ring-gold/40'
                }`}
              >
                <span className="text-sm text-ink">{u.username}</span>
                <span className="tabular text-sm text-gold">₹{u.balance.toLocaleString('en-IN')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">
            Credit <span className="text-ink">{selected.username}</span> with
          </span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="tabular w-36 rounded-xl bg-rim/60 px-4 py-2.5 text-center text-ink outline-none ring-1 ring-ink/20 focus:ring-gold/60"
          />
          <Button onClick={() => void addMoney()} disabled={busy || !amountValid}>
            {busy ? 'Adding…' : 'Add money'}
          </Button>
        </div>
      )}

      {notice && (
        <p className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-emerald-400' : 'text-wine'}`}>{notice.text}</p>
      )}
    </section>
  );
}
