import { CdpClient } from '@coinbase/cdp-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { encodeFunctionData, maxUint256, parseUnits } from 'viem';
import { getBaseReadClient, waitForBaseReceipt } from '@/lib/base-rpc';
import {
  ERC20_BALANCE_ABI,
  EVM_EVENT_SIGNATURES,
  EVM_TOPICS,
  LEAF_CONTRACT_ADDRESS,
  PIXOTCHI_NFT_ADDRESS,
  PIXOTCHI_TOKEN_ADDRESS,
} from '@/lib/contracts';
import {
  VERIFY_CLAIM_LEAF_BONUS_AMOUNT,
  VERIFY_CLAIM_SEED_BONUS_AMOUNT,
} from '@/lib/verify-claim-config';
import {
  advanceVerifyClaimRecord,
  createVerifyClaimReservation,
  createVerifyClaimRetryAttempt,
  getVerifyClaimPairState,
  getVerifyClaimKey,
  getVerifyPendingKey,
  getVerifyWalletClaimKey,
  normalizeVerifyWalletAddress,
  readVerifyClaimJSON,
  resumeVerifyClaimPairBeforeSubmission,
  reserveVerifyClaimPair,
  writeVerifyClaimPair,
  type VerifyClaimReservationRecord,
  type VerifyPendingRecord,
} from '@/lib/verify-claim-records';

/**
 * Feature toggle for Base Verify claims.
 * Set NEXT_PUBLIC_VERIFY_CLAIM_ENABLED=true to enable both frontend UI and backend API.
 */
const VERIFY_CLAIM_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED === 'true';

let cdp: CdpClient | null = null;
function getClient() {
  if (!cdp) cdp = new CdpClient();
  return cdp;
}

let agentSmartAccount: UntypedValue = null;

const ELIGIBLE_STRAINS = [1, 2, 3, 4];
const LEAF_BONUS_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_LEAF_BONUS_ENABLED === 'true';
const LEAF_BONUS_AMOUNT = parseUnits(VERIFY_CLAIM_LEAF_BONUS_AMOUNT, 18);
const SEED_BONUS_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_SEED_BONUS_ENABLED === 'true';
const SEED_BONUS_AMOUNT = parseUnits(VERIFY_CLAIM_SEED_BONUS_AMOUNT, 18);

const ERC20_APPROVE_ABI = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const ERC20_TRANSFER_ABI = [{
  type: 'function',
  name: 'transfer',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const NFT_MINT_ABI = [{
  type: 'function',
  name: 'mint',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'strain', type: 'uint256' }],
  outputs: [],
}] as const;

const NFT_TRANSFER_ABI = [{
  type: 'function',
  name: 'transferFrom',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
  ],
  outputs: [],
}] as const;

class ClaimStateUnavailableError extends Error {
  constructor() {
    super('Claim recovery state could not be persisted');
    this.name = 'ClaimStateUnavailableError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Claim failed';
}

function operationHash(operation: UntypedValue): string | undefined {
  return typeof operation?.userOpHash === 'string'
    ? operation.userOpHash
    : typeof operation?.id === 'string'
      ? operation.id
      : typeof operation === 'string'
        ? operation
        : undefined;
}

function recoveryResponse(record: VerifyClaimReservationRecord, message: string) {
  return NextResponse.json({
    success: true,
    status: 'partial',
    reservationId: record.reservationId,
    recoveryStage: record.stage,
    mintTxHash: record.mintTxHash,
    transferTxHash: record.transferTxHash,
    tokenId: record.tokenId,
    message,
  }, {
    status: 202,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(req: NextRequest) {
  if (!VERIFY_CLAIM_ENABLED) {
    return NextResponse.json({ error: 'Verification claims are currently disabled' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { userAddress, verificationToken, provider, strainId } = body;

    if (
      typeof userAddress !== 'string' ||
      typeof verificationToken !== 'string' ||
      typeof provider !== 'string' ||
      !userAddress ||
      !verificationToken ||
      !provider
    ) {
      return NextResponse.json({ error: 'Missing or invalid required parameters' }, { status: 400 });
    }

    const normalizedUserAddress = normalizeVerifyWalletAddress(userAddress);
    if (!normalizedUserAddress) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    const normalizedProvider = provider.trim();
    const targetStrainId = strainId === undefined ? 4 : Number(strainId);
    if (!Number.isInteger(targetStrainId) || !ELIGIBLE_STRAINS.includes(targetStrainId)) {
      return NextResponse.json({
        error: `Strain ${targetStrainId} is not eligible for free claim. Eligible strains: ${ELIGIBLE_STRAINS.join(', ')}`,
      }, { status: 400 });
    }

    const pendingResult = await readVerifyClaimJSON<VerifyPendingRecord>(
      getVerifyPendingKey(verificationToken),
    );
    if (pendingResult.status === 'unavailable') {
      console.error('[CLAIM] Pending verification state unavailable:', pendingResult.error);
      return NextResponse.json(
        { error: 'Claim service is temporarily unavailable. No claim was submitted.' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const pendingRecord = pendingResult.status === 'ok' ? pendingResult.value : null;
    if (
      !pendingRecord ||
      pendingRecord.status !== 'verified_pending' ||
      pendingRecord.token !== verificationToken ||
      pendingRecord.expiresAt < Date.now()
    ) {
      return NextResponse.json(
        { error: 'Verification token is not pending or has expired. Please verify again.' },
        { status: 400 },
      );
    }

    if (
      pendingRecord.address !== normalizedUserAddress ||
      pendingRecord.provider !== normalizedProvider
    ) {
      return NextResponse.json(
        { error: 'Verification token does not match this wallet or provider.' },
        { status: 403 },
      );
    }

    let claimKey = getVerifyClaimKey(verificationToken);
    const walletClaimKey = getVerifyWalletClaimKey(normalizedUserAddress);
    const [claimRead, walletClaimRead] = await Promise.all([
      readVerifyClaimJSON<VerifyClaimReservationRecord>(claimKey),
      readVerifyClaimJSON<VerifyClaimReservationRecord>(walletClaimKey),
    ]);

    if (claimRead.status === 'unavailable' || walletClaimRead.status === 'unavailable') {
      console.error('[CLAIM] Existing claim state unavailable', {
        claimRead: claimRead.status,
        walletClaimRead: walletClaimRead.status,
      });
      return NextResponse.json(
        { error: 'Claim service is temporarily unavailable. No claim was submitted.' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const existingRecord = claimRead.status === 'ok'
      ? claimRead.value
      : walletClaimRead.status === 'ok'
        ? walletClaimRead.value
        : null;
    let record: VerifyClaimReservationRecord;
    if (existingRecord) {
      const matchesCurrentRequest = (candidate: VerifyClaimReservationRecord) => (
        normalizeVerifyWalletAddress(candidate.userAddress) === normalizedUserAddress
        && candidate.provider === normalizedProvider
        && candidate.strainId === targetStrainId
      );
      const retryClaimKey = getVerifyClaimKey(existingRecord.verificationToken);
      const retryClaimRead = retryClaimKey === claimKey
        ? claimRead
        : await readVerifyClaimJSON<VerifyClaimReservationRecord>(retryClaimKey);

      if (retryClaimRead.status === 'unavailable') {
        console.error('[CLAIM] Retry reservation state unavailable:', retryClaimRead.error);
        return NextResponse.json(
          { error: 'Claim service is temporarily unavailable. No claim was submitted.' },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      const retryClaimRecord = retryClaimRead.status === 'ok' ? retryClaimRead.value : null;
      const retryWalletRecord = walletClaimRead.status === 'ok' ? walletClaimRead.value : null;
      const retryPairMatchesRequest = (
        retryClaimRecord !== null
        && retryWalletRecord !== null
        && retryClaimRecord.reservationId === existingRecord.reservationId
        && retryWalletRecord.reservationId === existingRecord.reservationId
        && retryClaimRecord.verificationToken === existingRecord.verificationToken
        && retryWalletRecord.verificationToken === existingRecord.verificationToken
        && JSON.stringify(retryClaimRecord.idempotencyKeys) === JSON.stringify(retryWalletRecord.idempotencyKeys)
        && matchesCurrentRequest(retryClaimRecord)
        && matchesCurrentRequest(retryWalletRecord)
      );
      const retryStartedAt = Date.now();
      const retryPairState = retryPairMatchesRequest
        ? getVerifyClaimPairState(retryClaimRecord, retryWalletRecord, retryStartedAt)
        : 'manual_review';
      const retryPairIsSafe = retryPairState === 'retryable';

      if (!retryPairIsSafe || !retryClaimRecord || !retryWalletRecord) {
        return NextResponse.json({
          error: existingRecord.status === 'complete'
            ? 'This verification or wallet has already claimed a plant.'
            : 'This claim is already reserved and may require reconciliation. It will not be submitted again.',
          status: existingRecord.status,
          claimState: retryPairState,
          recoveryStage: existingRecord.stage,
          reservationId: existingRecord.reservationId,
        }, {
          status: 409,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }

      claimKey = retryClaimKey;
      record = createVerifyClaimRetryAttempt(retryClaimRecord, retryStartedAt);
      const resumeResult = await resumeVerifyClaimPairBeforeSubmission(
        claimKey,
        walletClaimKey,
        retryClaimRecord,
        record,
        retryStartedAt,
      );
      if (resumeResult.status === 'unavailable') {
        console.error('[CLAIM] Claim retry reservation unavailable:', resumeResult.error);
        return NextResponse.json(
          { error: 'Claim retry could not be reserved. No blockchain claim was submitted.' },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      if (resumeResult.status === 'conflict') {
        return NextResponse.json(
          { error: 'This claim changed while retrying. Check its status before trying again.' },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
    } else {
      record = createVerifyClaimReservation({
        userAddress: normalizedUserAddress,
        verificationToken,
        provider: normalizedProvider,
        strainId: targetStrainId,
      });
      const reserveResult = await reserveVerifyClaimPair(claimKey, walletClaimKey, record);
      if (reserveResult.status === 'unavailable') {
        console.error('[CLAIM] Claim reservation unavailable:', reserveResult.error);
        return NextResponse.json(
          {
            error: 'Claim reservation status could not be confirmed. No blockchain claim was submitted.',
            reservationId: record.reservationId,
          },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      if (reserveResult.status === 'conflict') {
        return NextResponse.json(
          { error: 'This verification or wallet already has a claim reservation.' },
          { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
    }

    let externalSubmissionAttempted = false;
    const persist = async (update: Partial<VerifyClaimReservationRecord>) => {
      record = advanceVerifyClaimRecord(record, update);
      if (!await writeVerifyClaimPair(claimKey, walletClaimKey, record)) {
        throw new ClaimStateUnavailableError();
      }
      return record;
    };

    try {
      const client = getClient();
      if (!agentSmartAccount) {
        const owner = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
        agentSmartAccount = await client.evm.getOrCreateSmartAccount({
          name: 'pixotchi-agent-sa-sp',
          owner,
          enableSpendPermissions: true,
        });
      }

      await persist({
        stage: 'mint_submitting',
        agentAddress: agentSmartAccount.address,
        leafBonusStage: LEAF_BONUS_ENABLED ? 'pending' : 'disabled',
        leafBonusSent: false,
        leafBonusAmount: LEAF_BONUS_ENABLED ? VERIFY_CLAIM_LEAF_BONUS_AMOUNT : null,
        seedBonusStage: SEED_BONUS_ENABLED ? 'pending' : 'disabled',
        seedBonusSent: false,
        seedBonusAmount: SEED_BONUS_ENABLED ? VERIFY_CLAIM_SEED_BONUS_AMOUNT : null,
      });

      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [PIXOTCHI_NFT_ADDRESS, maxUint256],
      });
      const mintData = encodeFunctionData({
        abi: NFT_MINT_ABI,
        functionName: 'mint',
        args: [BigInt(targetStrainId)],
      });

      console.log(`[CLAIM] Minting strain ${targetStrainId} for ${normalizedUserAddress} via Agent...`);
      externalSubmissionAttempted = true;
      const mintOp = await client.evm.sendUserOperation({
        smartAccount: agentSmartAccount,
        network: 'base',
        calls: [
          { to: PIXOTCHI_TOKEN_ADDRESS, value: BigInt(0), data: approveData },
          { to: PIXOTCHI_NFT_ADDRESS, value: BigInt(0), data: mintData },
        ],
        idempotencyKey: record.idempotencyKeys.mint,
      });
      await persist({
        stage: 'mint_submitted',
        mintUserOpHash: operationHash(mintOp),
      });

      const mintReceipt = await agentSmartAccount.waitForUserOperation(mintOp);
      if (mintReceipt.status !== 'complete') throw new Error('Mint transaction failed');
      await persist({
        stage: 'mint_confirmed',
        mintTxHash: mintReceipt.transactionHash,
      });

      console.log(`[CLAIM] Mint complete, tx: ${mintReceipt.transactionHash}`);
      let mintedTokenId: bigint | null = null;
      try {
        const txReceipt = await waitForBaseReceipt(mintReceipt.transactionHash as `0x${string}`);
        const agentTopic = `0x000000000000000000000000${agentSmartAccount.address.slice(2).toLowerCase()}`;
        for (const log of txReceipt.logs || []) {
          if (`${log.address}`.toLowerCase() !== PIXOTCHI_NFT_ADDRESS.toLowerCase()) continue;
          const topics = log.topics as string[];
          if (!topics || topics.length < 4) continue;
          if (topics[0].toLowerCase() !== EVM_EVENT_SIGNATURES.ERC20_TRANSFER) continue;
          if (
            topics[1].toLowerCase() === EVM_TOPICS.ZERO_ADDRESS_TOPIC &&
            topics[2].toLowerCase() === agentTopic
          ) {
            try {
              mintedTokenId = BigInt(topics[3]);
              break;
            } catch {
              // Continue scanning in case another matching log is well formed.
            }
          }
        }
      } catch (parseError) {
        console.error('[CLAIM] Error parsing mint logs:', parseError);
      }

      if (mintedTokenId === null) {
        await persist({
          status: 'mint_complete_transfer_pending',
          stage: 'manual_review',
          failedAt: Date.now(),
          error: 'Mint confirmed but token ID could not be parsed',
        });
        return recoveryResponse(
          record,
          'Plant mint confirmed, but its token ID needs reconciliation before transfer. Contact support with the reservation ID.',
        );
      }

      await persist({
        stage: 'transfer_ready',
        tokenId: mintedTokenId.toString(),
      });

      const transferData = encodeFunctionData({
        abi: NFT_TRANSFER_ABI,
        functionName: 'transferFrom',
        args: [
          agentSmartAccount.address as `0x${string}`,
          normalizedUserAddress as `0x${string}`,
          mintedTokenId,
        ],
      });

      await persist({ stage: 'transfer_submitting' });
      console.log(`[CLAIM] Transferring token ${mintedTokenId} to ${normalizedUserAddress}...`);
      const transferOp = await client.evm.sendUserOperation({
        smartAccount: agentSmartAccount,
        network: 'base',
        calls: [{ to: PIXOTCHI_NFT_ADDRESS, value: BigInt(0), data: transferData }],
        idempotencyKey: record.idempotencyKeys.transfer,
      });
      await persist({
        stage: 'transfer_submitted',
        transferUserOpHash: operationHash(transferOp),
      });

      const transferReceipt = await agentSmartAccount.waitForUserOperation(transferOp);
      if (transferReceipt.status !== 'complete') throw new Error('NFT transfer transaction failed');

      await persist({
        status: 'complete',
        stage: 'complete',
        transferTxHash: transferReceipt.transactionHash,
        transferError: null,
      });
      console.log(`[CLAIM] Transfer successful, tx: ${transferReceipt.transactionHash}`);

      let leafBonus: { txHash: string; amount: string } | null = null;
      let bonusStateIsSafe = true;
      if (LEAF_BONUS_ENABLED) {
        let leafSubmissionAttempted = false;
        try {
          await persist({ leafBonusStage: 'submitting' });
          const leafTransferData = encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [normalizedUserAddress as `0x${string}`, LEAF_BONUS_AMOUNT],
          });
          leafSubmissionAttempted = true;
          const leafOp = await client.evm.sendUserOperation({
            smartAccount: agentSmartAccount,
            network: 'base',
            calls: [{ to: LEAF_CONTRACT_ADDRESS, value: BigInt(0), data: leafTransferData }],
            idempotencyKey: record.idempotencyKeys.leafBonus,
          });
          await persist({
            leafBonusStage: 'submitted',
            leafBonusUserOpHash: operationHash(leafOp),
          });
          const leafReceipt = await agentSmartAccount.waitForUserOperation(leafOp);
          if (leafReceipt.status !== 'complete') throw new Error('LEAF bonus transaction failed');
          leafBonus = { txHash: leafReceipt.transactionHash, amount: VERIFY_CLAIM_LEAF_BONUS_AMOUNT };
          await persist({
            leafBonusStage: 'complete',
            leafBonusSent: true,
            leafBonusTxHash: leafReceipt.transactionHash,
          });
        } catch (error) {
          console.error('[CLAIM] LEAF bonus transfer failed:', errorMessage(error));
          const failedRecord = advanceVerifyClaimRecord(record, {
            leafBonusStage: leafSubmissionAttempted ? 'manual_review' : 'failed',
            leafBonusError: errorMessage(error),
          });
          const failureStored = await writeVerifyClaimPair(claimKey, walletClaimKey, failedRecord);
          if (failureStored) record = failedRecord;
          // Do not initiate another payout while one is ambiguous or while its
          // recovery state cannot be stored.
          bonusStateIsSafe = !leafSubmissionAttempted && failureStored;
        }
      }

      let seedBonus: { txHash: string; amount: string } | null = null;
      if (SEED_BONUS_ENABLED && bonusStateIsSafe) {
        let seedSubmissionAttempted = false;
        try {
          const balanceClient = getBaseReadClient();
          const seedBalance = await balanceClient.readContract({
            address: PIXOTCHI_TOKEN_ADDRESS,
            abi: ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args: [agentSmartAccount.address as `0x${string}`],
          });
          if ((seedBalance as bigint) < SEED_BONUS_AMOUNT) {
            await persist({ seedBonusStage: 'skipped' });
          } else {
            await persist({ seedBonusStage: 'submitting' });
            const seedTransferData = encodeFunctionData({
              abi: ERC20_TRANSFER_ABI,
              functionName: 'transfer',
              args: [normalizedUserAddress as `0x${string}`, SEED_BONUS_AMOUNT],
            });
            seedSubmissionAttempted = true;
            const seedOp = await client.evm.sendUserOperation({
              smartAccount: agentSmartAccount,
              network: 'base',
              calls: [{ to: PIXOTCHI_TOKEN_ADDRESS, value: BigInt(0), data: seedTransferData }],
              idempotencyKey: record.idempotencyKeys.seedBonus,
            });
            await persist({
              seedBonusStage: 'submitted',
              seedBonusUserOpHash: operationHash(seedOp),
            });
            const seedReceipt = await agentSmartAccount.waitForUserOperation(seedOp);
            if (seedReceipt.status !== 'complete') throw new Error('SEED bonus transaction failed');
            seedBonus = { txHash: seedReceipt.transactionHash, amount: VERIFY_CLAIM_SEED_BONUS_AMOUNT };
            await persist({
              seedBonusStage: 'complete',
              seedBonusSent: true,
              seedBonusTxHash: seedReceipt.transactionHash,
            });
          }
        } catch (error) {
          console.error('[CLAIM] SEED bonus transfer failed:', errorMessage(error));
          const failedRecord = advanceVerifyClaimRecord(record, {
            seedBonusStage: seedSubmissionAttempted ? 'manual_review' : 'failed',
            seedBonusError: errorMessage(error),
          });
          if (await writeVerifyClaimPair(claimKey, walletClaimKey, failedRecord)) record = failedRecord;
        }
      }

      const messageParts = ['Plant claimed and transferred successfully!'];
      if (leafBonus) messageParts.push('LEAF bonus sent.');
      if (seedBonus) messageParts.push('SEED bonus sent.');
      return NextResponse.json({
        success: true,
        status: 'complete',
        reservationId: record.reservationId,
        mintTxHash: record.mintTxHash,
        transferTxHash: record.transferTxHash,
        tokenId: record.tokenId,
        leafBonus,
        seedBonus,
        message: messageParts.join(' '),
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      console.error('[CLAIM] Claim error:', error);
      const manualReview = externalSubmissionAttempted;
      const failureRecord = advanceVerifyClaimRecord(record, {
        status: manualReview ? 'claim_failed_manual_review' : 'claim_failed_before_submission',
        stage: manualReview ? 'manual_review' : 'failed_before_submission',
        failedAt: Date.now(),
        error: errorMessage(error),
      });
      if (await writeVerifyClaimPair(claimKey, walletClaimKey, failureRecord)) record = failureRecord;

      if (manualReview) {
        return recoveryResponse(
          record,
          'The claim submission has an uncertain or incomplete result and will not be sent again automatically. Contact support with the reservation ID.',
        );
      }

      return NextResponse.json({
        error: 'The claim could not be started and its reservation was retained for safe reconciliation.',
        reservationId: record.reservationId,
        recoveryStage: record.stage,
      }, {
        status: error instanceof ClaimStateUnavailableError ? 503 : 500,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
  } catch (error) {
    console.error('[CLAIM] Outer error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
