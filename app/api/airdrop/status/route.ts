import { NextRequest, NextResponse } from 'next/server';
import {
    getAirdropRecordStatus,
    parseAirdropEligibility,
    type AirdropEligibilityRecord,
} from '@/lib/airdrop-claim-state';
import {
    createClaimedAirdropRecord,
    createFailedAirdropClaimRecord,
    getAirdropOperationOutcome,
    isAirdropTransactionHash,
    isAirdropUserOperationHash,
} from '@/lib/airdrop-claim-reconciliation';
import { getBaseTransactionReceipt } from '@/lib/base-rpc';
import { redis, redisCompareAndSetJSONRaw } from '@/lib/redis';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { CdpClient } from '@coinbase/cdp-sdk';

let cdp: CdpClient | null = null;
let agentSmartAccount: UntypedValue = null;

const STATUS_IP_LIMIT_PER_MINUTE = 120;
const STATUS_ADDRESS_LIMIT_PER_MINUTE = 30;

function getCdpClient() {
    cdp ??= new CdpClient();
    return cdp;
}

async function getPixotchiAgentSmartAccount() {
    if (!agentSmartAccount) {
        const client = getCdpClient();
        const owner = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
        agentSmartAccount = await client.evm.getOrCreateSmartAccount({
            name: 'pixotchi-agent-sa-sp',
            owner,
            enableSpendPermissions: true,
        });
    }
    return agentSmartAccount;
}

async function persistReconciledRecord(
    key: string,
    expectedRaw: string,
    next: AirdropEligibilityRecord,
    fallback: AirdropEligibilityRecord,
) {
    const persisted = await redisCompareAndSetJSONRaw(key, expectedRaw, JSON.stringify(next));
    if (persisted) return next;

    const latestRaw = await redis?.get(key);
    return latestRaw ? parseAirdropEligibility(latestRaw) ?? fallback : fallback;
}

async function reconcileOperation(
    key: string,
    raw: UntypedValue,
    record: AirdropEligibilityRecord,
) {
    // Status polling must only observe an already-dispatched user operation.
    if (getAirdropRecordStatus(record) !== 'pending' || !isAirdropUserOperationHash(record.operationId)) {
        return record;
    }

    try {
        const smartAccount = await getPixotchiAgentSmartAccount();
        const operation = await smartAccount.getUserOperation({ userOpHash: record.operationId });
        const outcome = getAirdropOperationOutcome(operation?.status);
        const expectedRaw = typeof raw === 'string' ? raw : JSON.stringify(record);

        if (outcome === 'failed') {
            return persistReconciledRecord(
                key,
                expectedRaw,
                createFailedAirdropClaimRecord(record),
                record,
            );
        }

        if (outcome !== 'complete' || !isAirdropTransactionHash(operation?.transactionHash)) {
            return record;
        }

        // CDP's completion is not enough on its own: save a user-visible tx
        // hash only after Base returns the canonical successful receipt.
        const receipt = await getBaseTransactionReceipt(operation.transactionHash);
        if (receipt.status !== 'success') {
            return persistReconciledRecord(
                key,
                expectedRaw,
                createFailedAirdropClaimRecord(record),
                record,
            );
        }

        return persistReconciledRecord(
            key,
            expectedRaw,
            createClaimedAirdropRecord(record, operation.transactionHash),
            record,
        );
    } catch {
        // An unavailable CDP/RPC must not turn an ambiguous payout into a
        // failed claim, nor must a GET request attempt a replacement payout.
        return record;
    }
}

/**
 * GET /api/airdrop/status?address=0x...
 * 
 * Check if a wallet is eligible for airdrop and their claim status.
 * No authentication required - public endpoint.
 */
export async function GET(req: NextRequest) {
    try {
        if (!redis) {
            return NextResponse.json({ error: 'Claim status service unavailable' }, { status: 503 });
        }

        const { searchParams } = new URL(req.url);
        const address = searchParams.get('address');

        if (!address) {
            return NextResponse.json({ error: 'Missing address parameter' }, { status: 400 });
        }

        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
        }

        // A pending eligible address triggers CDP plus a Base receipt read. The
        // endpoint remains public, but cap both a caller's IP and one address
        // before it can amplify polling into third-party RPC traffic.
        const rateLimitResponse = await enforceRateLimit(req, {
            failClosed: true,
            scope: 'api:airdrop:status',
            rules: [
                {
                    kind: 'ip',
                    identifier: getRequestIp(req),
                    limit: STATUS_IP_LIMIT_PER_MINUTE,
                    windowSeconds: 60,
                },
                {
                    kind: 'address',
                    identifier: address,
                    limit: STATUS_ADDRESS_LIMIT_PER_MINUTE,
                    windowSeconds: 60,
                },
            ],
        });
        if (rateLimitResponse) return rateLimitResponse;

        const key = `airdrop:eligible:${address.toLowerCase()}`;
        const data = await redis.get(key);

        if (!data) {
            return NextResponse.json({
                eligible: false,
                seed: '0',
                leaf: '0',
                pixotchi: '0',
                claimed: false,
                status: 'eligible',
            });
        }

        const parsed = parseAirdropEligibility(data);
        if (!parsed) {
            return NextResponse.json({ error: 'Invalid eligibility data' }, { status: 500 });
        }

        const reconciled = await reconcileOperation(key, data, parsed);
        const claimStatus = getAirdropRecordStatus(reconciled);

        return NextResponse.json({
            eligible: true,
            seed: reconciled.seed || '0',
            leaf: reconciled.leaf || '0',
            pixotchi: reconciled.pixotchi || '0',
            claimed: claimStatus === 'claimed',
            status: claimStatus,
            claimedAt: reconciled.claimedAt || null,
            txHash: claimStatus === 'claimed' ? reconciled.txHash || null : null,
        });

    } catch (error: UntypedValue) {
        console.error('[AIRDROP_STATUS] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
