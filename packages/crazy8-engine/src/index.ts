/**
 * @cardadda/crazy8-engine — public API.
 *
 * Pure, framework-independent Crazy 8s rule engine. Import from here in the
 * Socket.io server and the Next.js UI. No React / Socket.io dependencies live
 * inside this package, so it stays unit-testable in isolation.
 */

export * from './types';
export * from './deck';
export * from './rules';
export * from './scoring';
export * from './game';
