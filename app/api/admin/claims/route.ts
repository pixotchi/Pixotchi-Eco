import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';

/**
 * Raw SCAN that does NOT auto-prefix keys.
 * The claim routes use raw redis.set/get (no pixotchi: prefix),
 * so we must scan without the prefix too.
 *
 * IMPORTANT: Cursor is kept as a string to avoid JavaScript integer
 * precision loss — Upstash cursors can exceed Number.MAX_SAFE_INTEGER.
 */
async function scanKeysRaw(pattern: string, maxKeys: number = 10000): Promise<string[]> {
  if (!redis) return [];
  const results: string[] = [];
  let cursor = '0';
  do {
    const resp: UntypedValue = await (redis as UntypedValue).scan(cursor, { match: pattern, count: 1000 });
    if (Array.isArray(resp)) {
      cursor = String(resp[0]);
      const batch: string[] = (resp[1] || []) as string[];
      results.push(...batch);
    } else if (resp && typeof resp === 'object' && 'cursor' in resp) {
      cursor = String(resp.cursor);
      results.push(...((resp.keys || []) as string[]));
    } else {
      break;
    }
    if (results.length >= maxKeys) break;
  } while (cursor !== '0');
  return results;
}

/**
 * GET /api/admin/claims — List all Base Verify free plant claims
 *
 * Returns stats + list of all wallet claims from Redis.
 */
export async function GET(req: NextRequest) {
  const adminDenied = await requireAdmin(req);
  if (adminDenied) return adminDenied;

  try {
    // Scan for all wallet_claims keys (raw — no prefix, matching how claim route stores them)
    const keys = await scanKeysRaw('wallet_claims:*');

    if (!keys.length) {
      return NextResponse.json({
        success: true,
        stats: { total: 0, complete: 0, partial: 0, failed: 0, leafBonusSent: 0, seedBonusSent: 0 },
        claims: [],
      });
    }

    // Batch fetch all values
    const values = await redis?.mget(...keys);
    const claims: UntypedValue[] = [];
    let complete = 0;
    let partial = 0;
    let failed = 0;
    let leafBonusSent = 0;
    let seedBonusSent = 0;

    for (let i = 0; i < keys.length; i++) {
      const raw = values?.[i];
      if (!raw) continue;

      try {
        const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
        claims.push({
          address: record.userAddress,
          tokenId: record.tokenId,
          strainId: record.strainId,
          status: record.status,
          timestamp: record.timestamp,
          mintTxHash: record.mintTxHash,
          transferTxHash: record.transferTxHash,
          leafBonusSent: record.leafBonusSent || false,
          leafBonusAmount: record.leafBonusAmount || null,
          seedBonusSent: record.seedBonusSent || false,
          seedBonusAmount: record.seedBonusAmount || null,
        });

        if (record.status === 'complete') complete++;
        else if (record.status === 'transfer_failed') failed++;
        else partial++;

        if (record.leafBonusSent) leafBonusSent++;
        if (record.seedBonusSent) seedBonusSent++;
      } catch {
        // Skip unparseable records
      }
    }

    // Sort by timestamp descending (newest first)
    claims.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return NextResponse.json({
      success: true,
      stats: { total: claims.length, complete, partial, failed, leafBonusSent, seedBonusSent },
      claims,
    });
  } catch (error: UntypedValue) {
    console.error('[ADMIN_CLAIMS] GET error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch claims' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/claims — Delete claim(s)
 *
 * Modes:
 * - ?address=0x... — Delete a single wallet's claim records
 * - ?reset=all&confirm=true — Delete ALL claim records (bulk reset)
 */
export async function DELETE(req: NextRequest) {
  const adminDenied = await requireAdmin(req);
  if (adminDenied) return adminDenied;

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  const reset = searchParams.get('reset');
  const confirm = searchParams.get('confirm');

  try {
    // --- Single wallet delete ---
    if (address) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
      }

      const walletKey = `wallet_claims:${address.toLowerCase()}`;
      let deletedCount = 0;

      // Delete wallet_claims key (raw — no prefix)
      const walletResult = await redis?.del(walletKey);
      if (walletResult) deletedCount++;

      // Find and delete matching verified_claims key
      const verifiedKeys = await scanKeysRaw('verified_claims:*');
      for (const key of verifiedKeys) {
        const raw = await redis?.get(key);
        if (!raw) continue;
        try {
          const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (record.userAddress?.toLowerCase() === address.toLowerCase()) {
            await redis?.del(key);
            deletedCount++;
            break; // One wallet = one verified_claims record
          }
        } catch {
          // Skip
        }
      }

      await logAdminAction('claim_delete_single', 'system', { address, deletedCount });

      return NextResponse.json({
        success: true,
        deleted: deletedCount,
        message: `Deleted ${deletedCount} claim record(s) for ${address}`,
      });
    }

    // --- Bulk reset ---
    if (reset === 'all') {
      if (confirm !== 'true') {
        return NextResponse.json(
          { error: 'Confirmation required', message: 'Add ?confirm=true to proceed with bulk reset' },
          { status: 400 }
        );
      }

      // Scan and delete all wallet_claims keys (raw — no prefix)
      const walletKeys = await scanKeysRaw('wallet_claims:*');
      let walletDeleted = 0;
      const batchSize = 100;
      for (let i = 0; i < walletKeys.length; i += batchSize) {
        const batch = walletKeys.slice(i, i + batchSize);
        if (batch.length > 0) {
          await redis?.del(...batch);
          walletDeleted += batch.length;
        }
      }

      // Scan and delete all verified_claims keys (raw — no prefix)
      const verifiedKeys = await scanKeysRaw('verified_claims:*');
      let verifiedDeleted = 0;
      for (let i = 0; i < verifiedKeys.length; i += batchSize) {
        const batch = verifiedKeys.slice(i, i + batchSize);
        if (batch.length > 0) {
          await redis?.del(...batch);
          verifiedDeleted += batch.length;
        }
      }

      await logAdminAction('claims_reset_all', 'system', {
        walletDeleted,
        verifiedDeleted,
      });

      return NextResponse.json({
        success: true,
        deleted: { walletClaims: walletDeleted, verifiedClaims: verifiedDeleted },
        message: `Reset complete. Deleted ${walletDeleted} wallet claims + ${verifiedDeleted} verification records.`,
      });
    }

    return NextResponse.json({ error: 'Missing query parameter. Use ?address=0x... or ?reset=all&confirm=true' }, { status: 400 });
  } catch (error: UntypedValue) {
    console.error('[ADMIN_CLAIMS] DELETE error:', error);
    return NextResponse.json({ error: error.message || 'Delete operation failed' }, { status: 500 });
  }
}
