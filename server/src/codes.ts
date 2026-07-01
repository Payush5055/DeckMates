import { randomInt } from 'node:crypto';

/**
 * Alphabet for shareable room codes. Excludes visually ambiguous characters
 * (0/O, 1/I/L) so codes are easy to read aloud and type — Kahoot-style.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a random room code (default 6 chars). */
export function generateRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Generate a code guaranteed not to collide with an existing one.
 * `exists` reports whether a candidate is already taken.
 */
export function generateUniqueRoomCode(exists: (code: string) => boolean): string {
  let code = generateRoomCode();
  // Collisions are astronomically unlikely, but loop to be safe.
  while (exists(code)) code = generateRoomCode();
  return code;
}
