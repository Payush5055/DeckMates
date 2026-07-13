import {
  canRequestShow,
  evaluateSeatHand,
  getBetBounds,
  getSideShowTarget,
  showCost,
  visibleHand,
} from '@cardadda/teenpatti-engine';
import { requiredWagerAmount, SESSION_TOPUP } from '@cardadda/economy-engine';
import type {
  TeenPattiPublicPlayer,
  TeenPattiPublicRoomState,
  TeenPattiSelfState,
} from '@cardadda/shared';
import { TeenPattiRoom, TeenPattiRoomPlayer } from './teenPattiRoom';

function actionText(room: TeenPattiRoom): string | null {
  const action = room.game?.lastAction;
  if (!action) return null;
  const name = (seat: number) => room.playerBySeat(seat)?.name ?? `Seat ${seat}`;
  switch (action.type) {
    case 'bet':
      return `${name(action.seat)} bet ${action.amount} (${action.visibility})`;
    case 'see':
      return `${name(action.seat)} saw their cards`;
    case 'fold':
      return `${name(action.seat)} folded`;
    case 'sideShowRequested':
      return `${name(action.requester)} requested a side show with ${name(action.target)}`;
    case 'sideShowRefused':
      return `${name(action.target)} refused ${name(action.requester)}'s side show`;
    case 'sideShowAccepted':
      return `${name(action.loser)} lost the side show`;
    case 'show':
      return `${name(action.winner)} won the show${action.tie ? ' on a tie' : ''}`;
    case 'win':
      return `${name(action.seat)} won the pot`;
    default:
      return null;
  }
}

export function buildPublicRoomState(room: TeenPattiRoom): TeenPattiPublicRoomState {
  const players: TeenPattiPublicPlayer[] = [...room.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      seat: p.seat,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isHost: p.playerId === room.hostPlayerId,
      isBot: p.isBot,
      active: room.game ? room.game.active[p.seat] ?? false : true,
      seen: room.game ? room.game.seen[p.seat] ?? false : false,
      stack: room.wallets.get(p.playerId)?.stack ?? 0,
    }));

  return {
    roomCode: room.code,
    phase: room.phase,
    variant: room.variant,
    players,
    seatsFilled: room.players.length,
    turn: room.game?.turn ?? null,
    pot: room.game?.pot ?? 0,
    currentStake: room.game?.currentStake ?? 0,
    boot: room.game?.boot ?? 1,
    jokerRank: room.game?.jokerRank ?? null,
    hostPlayerId: room.hostPlayerId,
    canStartNow: room.canStartNow(),
    pendingSideShow: room.game?.pendingSideShow
      ? {
          requester: room.game.pendingSideShow.requester,
          target: room.game.pendingSideShow.target,
          cost: room.game.pendingSideShow.cost,
        }
      : null,
    winnerSeat: room.game?.winner ?? null,
    lastAction: actionText(room),
  };
}

export function buildSelfState(room: TeenPattiRoom, player: TeenPattiRoomPlayer): TeenPattiSelfState {
  const wallet = room.wallets.get(player.playerId);
  const bankroll = (wallet?.startingPermanent ?? 0) + SESSION_TOPUP;
  const session = {
    startingPermanent: wallet?.startingPermanent ?? 0,
    bankroll,
    wagered: wallet?.wagered ?? 0,
    requiredWager: requiredWagerAmount(bankroll),
  };

  const game = room.game;
  if (!game) {
    return {
      playerId: player.playerId,
      seat: player.seat,
      hand: null,
      seen: false,
      minBet: null,
      maxBet: null,
      canSeeCards: false,
      canFold: false,
      canBet: false,
      canShow: false,
      showCost: null,
      canSideShow: false,
      sideShowTargetSeat: null,
      pendingSideShowResponse: null,
      session,
    };
  }

  const onTurn = game.phase === 'playing' && game.turn === player.seat && game.active[player.seat];
  const pendingResponse =
    game.phase === 'sideShow' && game.pendingSideShow && game.pendingSideShow.target === player.seat
      ? { requester: game.pendingSideShow.requester, cost: game.pendingSideShow.cost }
      : null;

  let minBet: number | null = null;
  let maxBet: number | null = null;
  if (onTurn) {
    const bounds = getBetBounds(game, player.seat);
    minBet = bounds.min;
    // Clamped to the player's remaining stack — the engine's bounds assume
    // unlimited money, but a real session stack can run out mid-escalation.
    maxBet = Math.min(bounds.max, wallet?.stack ?? bounds.max);
  }

  return {
    playerId: player.playerId,
    seat: player.seat,
    hand: visibleHand(game, player.seat),
    seen: game.seen[player.seat] ?? false,
    minBet,
    maxBet,
    canSeeCards: onTurn && !game.seen[player.seat],
    canFold: onTurn,
    canBet: onTurn,
    canShow: onTurn && canRequestShow(game, player.seat),
    showCost: onTurn && canRequestShow(game, player.seat) ? showCost(game, player.seat) : null,
    canSideShow: onTurn && getSideShowTarget(game, player.seat) !== null,
    sideShowTargetSeat: onTurn ? getSideShowTarget(game, player.seat) : null,
    pendingSideShowResponse: pendingResponse,
    session,
  };
}
