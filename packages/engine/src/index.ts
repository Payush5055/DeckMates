/**
 * @cardadda/engine — public API.
 *
 * Pure, framework-independent Callbreak rule engine. Import from here in the
 * Socket.io server and the Next.js UI. No React / Socket.io dependencies live
 * inside this package, so it stays unit-testable in isolation and reusable when
 * we add more games later.
 */

export * from './types';
export * from './deck';
export * from './trick';
export * from './scoring';
export * from './game';
