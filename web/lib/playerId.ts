/**
 * Persistent, login-free identity. A random player id lives in localStorage so
 * the same browser reclaims its seat on reconnect and owns its match history.
 */

const PID_KEY = 'deckmates:playerId';
const NAME_KEY = 'deckmates:name';

export function getPlayerId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(PID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(PID_KEY, id);
  }
  return id;
}

export function getSavedName(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NAME_KEY, name.trim().slice(0, 20));
}
