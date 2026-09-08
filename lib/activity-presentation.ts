import { BlackjackResult } from '@/public/abi/blackjack-abi';

export function activityInteger(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

export function activityDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const seconds = Number(value);
  const date = new Date(seconds * 1000);
  return Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(date.getTime()) ? date : null;
}

export function blackjackActivityOutcome(result: number): { label: string; won: boolean } {
  switch (result) {
    case BlackjackResult.PLAYER_WIN: return { label: 'won', won: true };
    case BlackjackResult.PLAYER_BLACKJACK: return { label: 'won with blackjack', won: true };
    case BlackjackResult.PUSH: return { label: 'pushed', won: false };
    case BlackjackResult.SURRENDERED: return { label: 'surrendered', won: false };
    case BlackjackResult.PLAYER_BUST: return { label: 'busted', won: false };
    case BlackjackResult.DEALER_WIN:
    case BlackjackResult.DEALER_BLACKJACK: return { label: 'lost', won: false };
    default: return { label: 'completed a hand', won: false };
  }
}
