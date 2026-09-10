import { NextRequest, NextResponse } from 'next/server';
import { getBaseReadClient } from '@/lib/base-rpc';
import { getAirdropAdapter } from '@/lib/airdrop-cdp';
import { publicAirdropStatus, runAirdropClaim } from '@/lib/airdrop-execution';
import { createAirdropStore } from '@/lib/airdrop-store';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { isAddress, type Hex } from 'viem';

const headers = { 'Cache-Control': 'private, no-store' };
function getClaimMessage(address: string, timestamp: number): string {
  return `Claim Pixotchi Airdrop\n\nWallet: ${address.toLowerCase()}\nTimestamp: ${timestamp}\n\nBy signing this message, you confirm ownership of this wallet and request to claim your airdrop allocation.`;
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers });
    const { userAddress, signature, timestamp } = body as Record<string, unknown>;
    if (typeof userAddress !== 'string' || !isAddress(userAddress) || typeof signature !== 'string'
      || !/^0x[0-9a-f]+$/i.test(signature) || signature.length > 32_768 || typeof timestamp !== 'number'
      || !Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) {
      return NextResponse.json({ error: 'Invalid or expired claim signature' }, { status: 400, headers });
    }
    const denied = await enforceRateLimit(req, { failClosed: true, scope: 'api:airdrop:claim', rules: [
      { kind: 'ip', identifier: getRequestIp(req), limit: 30, windowSeconds: 60 },
      { kind: 'address', identifier: userAddress, limit: 10, windowSeconds: 60 },
    ] });
    if (denied) return denied;
    const valid = await getBaseReadClient().verifyMessage({ address: userAddress, message: getClaimMessage(userAddress, timestamp), signature: signature as Hex });
    if (!valid) return NextResponse.json({ error: 'Invalid claim signature' }, { status: 401, headers });
    const store = createAirdropStore(userAddress);
    if (!await store.read()) return NextResponse.json({ error: 'Not eligible for airdrop' }, { status: 400, headers });
    const record = await runAirdropClaim(store, getAirdropAdapter(), userAddress);
    const result = publicAirdropStatus(record);
    return NextResponse.json({
      ...result, success: result.claimed,
      ...(result.claimed ? {} : { error: result.recoveryState === 'manual_review'
        ? 'Your claim needs review. Contact support with the claim reference.'
        : result.retryAllowed ? 'Claim preparation can be retried safely.' : 'Your claim is being confirmed.' }),
    }, { status: result.claimed ? 200 : 409, headers });
  } catch {
    return NextResponse.json({ error: 'Claim service unavailable. Check status before retrying.' }, { status: 503, headers });
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address || !isAddress(address)) return NextResponse.json({ error: 'Valid address required' }, { status: 400, headers });
  const timestamp = Date.now();
  return NextResponse.json({ message: getClaimMessage(address, timestamp), timestamp, address: address.toLowerCase() }, { headers });
}
