/**
 * @cardadda/thirtyone-engine — public API.
 *
 * Pure, framework-independent 31 (Scat/Blitz) rule engine. Import from here in
 * the Socket.io server and the Next.js UI. No React / Socket.io dependencies
 * live inside this package, so it stays unit-testable in isolation.
 */

export * from './types';
export * from './scoring';
export * from './game';
