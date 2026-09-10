import { NextRequest, NextResponse } from 'next/server';
import { getAirdropAdapter } from '@/lib/airdrop-cdp';
import { isAirdropObservable, observeAirdrop, publicAirdropStatus } from '@/lib/airdrop-execution';
import { createAirdropStore } from '@/lib/airdrop-store';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { isAddress } from 'viem';

const headers = { 'Cache-Control': 'private, no-store' };
/** Observation only: this endpoint never signs, prepares, or broadcasts a payout. */
export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get('address');
    if (!address || !isAddress(address)) return NextResponse.json({ error: 'Invalid address' }, { status: 400, headers });
    const denied = await enforceRateLimit(req, { failClosed: true, scope: 'api:airdrop:status', rules: [
      { kind: 'ip', identifier: getRequestIp(req), limit: 120, windowSeconds: 60 },
      { kind: 'address', identifier: address, limit: 30, windowSeconds: 60 },
    ] });
    if (denied) return denied;
    const store = createAirdropStore(address);
    const snapshot = await store.read();
    if (!snapshot) return NextResponse.json({ eligible: false, claimed: false, seed: '0', leaf: '0', pixotchi: '0', status: 'eligible', recoveryState: 'ready', retryAllowed: false }, { headers });
    if (!isAirdropObservable(snapshot.record)) {
      if (snapshot.record.status === 'pending' && !snapshot.record.execution && !snapshot.record.operationId) await store.metric?.('legacy_ambiguous_observed').catch(() => {});
      return NextResponse.json(publicAirdropStatus(snapshot.record), { headers });
    }
    const reconciled = await observeAirdrop(snapshot, store, getAirdropAdapter(), Date.now(), address);
    return NextResponse.json(publicAirdropStatus(reconciled.record), { headers });
  } catch {
    return NextResponse.json({ error: 'Claim status temporarily unavailable' }, { status: 503, headers });
  }
}
