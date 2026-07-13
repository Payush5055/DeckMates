import {
  canRequestShow,
  evaluateSeatHand,
  getBetBounds,
  getSideShowTarget,
  isBlind,
  type GameState,
  type Seat,
} from '@cardadda/teenpatti-engine';

type BotAction =
  | { action: 'see' }
  | { action: 'bet'; amount: number }
  | { action: 'fold' }
  | { action: 'show' }
  | { action: 'sideShow' };

function categoryScore(state: GameState, seat: Seat): number {
  const category = evaluateSeatHand(state, seat).category;
  switch (category) {
    case 'trail':
      return 5;
    case 'pureSequence':
      return 4;
    case 'sequence':
      return 3;
    case 'color':
      return 2;
    case 'pair':
      return 1;
    default:
      return 0;
  }
}

export function chooseAction(state: GameState, seat: Seat): BotAction {
  const score = categoryScore(state, seat);
  const active = state.active.filter(Boolean).length;

  if (canRequestShow(state, seat) && (score >= 1 || state.currentStake >= state.boot * 6)) {
    return { action: 'show' };
  }

  const sideShowTarget = getSideShowTarget(state, seat);
  if (sideShowTarget !== null && score >= 3 && state.currentStake <= state.boot * 6) {
    return { action: 'sideShow' };
  }

  if (isBlind(state, seat) && score <= 1 && state.currentStake >= state.boot * 3) {
    return { action: 'see' };
  }

  if (score === 0 && state.currentStake >= state.boot * (state.seen[seat] ? 6 : 8)) {
    return { action: 'fold' };
  }

  if (active <= 3 && score === 0 && state.seen[seat]) {
    return { action: 'fold' };
  }

  const { min, max } = getBetBounds(state, seat);
  if (score >= 4) return { action: 'bet', amount: max };
  if (score >= 2) return { action: 'bet', amount: Math.min(max, min + state.currentStake) };
  return { action: 'bet', amount: min };
}

export function chooseSideShowResponse(state: GameState, seat: Seat): boolean {
  const score = categoryScore(state, seat);
  return score >= 1 || state.currentStake <= state.boot * 3;
}
