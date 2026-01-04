/**
 * Bridge Message Diagnostic API
 * 
 * Diagnoses the status of a Solana→Base bridge message.
 * Call: GET /api/bridge/diagnose?pubkey=<outgoingMessagePubkey>
 * 
 * Uses RPCs from environment variables (see lib/solana-constants.ts):
 * - NEXT_PUBLIC_SOLANA_RPC_URL: Solana mainnet RPC
 * - NEXT_PUBLIC_RPC_NODE: Base mainnet RPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, keccak256, encodeAbiParameters, toHex, padHex, type Hex, type Address } from 'viem';
import { base } from 'viem/chains';
import { Connection, PublicKey } from '@solana/web3.js';

// Segment config: Always fetch fresh onchain data
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// Use existing environment variable conventions from lib/solana-constants.ts
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined; // Uses viem default if not set

// Mainnet-only configuration (matching lib/solana-constants.ts)
const CONFIG = {
  solanaRpc: SOLANA_RPC,
  baseChain: base,
  baseRpc: BASE_RPC,
  // Bridge contract addresses from SOLANA_BRIDGE_CONFIG
  bridgeContract: '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188' as Address,
  bridgeValidator: '0xAF24c1c24Ff3BF1e6D882518120fC25442d6794B' as Address,
  wSol: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address,
};

const BRIDGE_VALIDATOR_ABI = [
  { name: 'validMessages', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'nextNonce', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const BRIDGE_ABI = [
  { name: 'successes', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'failures', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pubkey = searchParams.get('pubkey');

  if (!pubkey) {
    return NextResponse.json({ error: 'Missing pubkey parameter' }, { status: 400 });
  }

  const config = CONFIG;

  try {
    // Step 1: Fetch OutgoingMessage from Solana
    const connection = new Connection(config.solanaRpc);
    const solPubkey = new PublicKey(pubkey);
    const accountInfo = await connection.getAccountInfo(solPubkey);

    if (!accountInfo) {
      return NextResponse.json({
        status: 'NOT_FOUND',
        message: 'OutgoingMessage account not found on Solana. The bridge_sol transaction may have failed.',
        steps: { solanaAccount: false }
      });
    }

    // Decode message
    const outgoingMessage = decodeOutgoingMessage(accountInfo.data);

    // Step 2: Compute message hash
    const { innerHash, outerHash, evmMessage } = buildEvmMessage(pubkey, outgoingMessage);

    // Step 3: Check Base contracts
    const publicClient = createPublicClient({
      chain: config.baseChain,
      transport: http(config.baseRpc) // Uses env RPC or default
    });

    const [isValidated, validatorNextNonce, isSuccess, isFailed, isPaused] = await Promise.all([
      publicClient.readContract({
        address: config.bridgeValidator,
        abi: BRIDGE_VALIDATOR_ABI,
        functionName: 'validMessages',
        args: [outerHash as `0x${string}`],
      }),
      publicClient.readContract({
        address: config.bridgeValidator,
        abi: BRIDGE_VALIDATOR_ABI,
        functionName: 'nextNonce',
      }),
      publicClient.readContract({
        address: config.bridgeContract,
        abi: BRIDGE_ABI,
        functionName: 'successes',
        args: [outerHash as `0x${string}`],
      }),
      publicClient.readContract({
        address: config.bridgeContract,
        abi: BRIDGE_ABI,
        functionName: 'failures',
        args: [outerHash as `0x${string}`],
      }),
      publicClient.readContract({
        address: config.bridgeContract,
        abi: BRIDGE_ABI,
        functionName: 'paused',
      }),
    ]);

    // Determine status
    let status: string;
    let message: string;
    let action: string;

    if (isSuccess) {
      status = 'SUCCESS';
      message = 'Message was successfully executed on Base! Tokens should be in your wallet.';
      action = 'Check your wSOL balance on Base';
    } else if (isFailed) {
      status = 'FAILED';
      message = 'Message execution failed on Base. This could be due to insufficient gas or a contract revert.';
      action = 'Try calling relayMessages() again with higher gas limit';
    } else if (!isValidated) {
      const nonceGap = Number(validatorNextNonce) - Number(outgoingMessage.nonce);
      if (nonceGap <= 0) {
        status = 'PENDING_VALIDATION';
        message = 'Waiting for validators to approve this message. This typically takes 5-15 minutes.';
        action = 'Wait for validator approval or check if PayForRelay was included';
      } else {
        status = 'NONCE_MISMATCH';
        message = `Your message nonce (${outgoingMessage.nonce}) is lower than validator's next nonce (${validatorNextNonce}). This could indicate a hash computation issue.`;
        action = 'Check message encoding or contact support';
      }
    } else {
      status = 'PENDING_RELAY';
      message = 'Message is validated but not yet relayed to Base.';
      action = 'Wait for auto-relay or manually call Bridge.relayMessages()';
    }

    return NextResponse.json({
      status,
      message,
      action,
      details: {
        network: 'mainnet',
        outgoingMessagePubkey: pubkey,
        messageNonce: outgoingMessage.nonce.toString(),
        validatorNextNonce: validatorNextNonce.toString(),
        innerHash,
        outerHash,
        isValidated,
        isSuccess,
        isFailed,
        bridgePaused: isPaused,
      },
      evmMessage: isValidated && !isSuccess && !isFailed ? {
        outgoingMessagePubkey: evmMessage.outgoingMessagePubkey,
        gasLimit: evmMessage.gasLimit.toString(),
        nonce: evmMessage.nonce.toString(),
        sender: evmMessage.sender,
        ty: evmMessage.ty,
        data: evmMessage.data,
      } : undefined,
      contracts: {
        bridgeValidator: config.bridgeValidator,
        bridge: config.bridgeContract,
        wSol: config.wSol,
      },
    });
  } catch (error) {
    console.error('Bridge diagnostic error:', error);
    return NextResponse.json({
      error: 'Diagnostic failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Helper functions (same as CLI script)
interface OutgoingMessageData {
  nonce: bigint;
  sender: string;
  message: { __kind: 'Call' | 'Transfer'; fields: any[] };
}

function decodeOutgoingMessage(data: Buffer): OutgoingMessageData {
  let offset = 8; // Skip discriminator

  const nonce = BigInt('0x' + data.subarray(offset, offset + 8).reverse().toString('hex'));
  offset += 8;

  const sender = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;

  const variant = data[offset];
  offset += 1;

  let message: OutgoingMessageData['message'];

  if (variant === 0) {
    message = { __kind: 'Call', fields: [decodeCall(data, offset)] };
  } else if (variant === 1) {
    message = { __kind: 'Transfer', fields: [decodeTransfer(data, offset)] };
  } else {
    throw new Error(`Unknown message variant: ${variant}`);
  }

  return { nonce, sender, message };
}

function decodeTransfer(data: Buffer, offset: number): any {
  const to = data.subarray(offset, offset + 20);
  offset += 20;
  const localToken = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const remoteToken = data.subarray(offset, offset + 20);
  offset += 20;
  const amount = BigInt('0x' + data.subarray(offset, offset + 8).reverse().toString('hex'));
  offset += 8;
  const hasCall = data[offset];
  offset += 1;
  let call = null;
  if (hasCall === 1) call = decodeCall(data, offset);

  return {
    to: `0x${Buffer.from(to).toString('hex')}`,
    localToken,
    remoteToken: `0x${Buffer.from(remoteToken).toString('hex')}`,
    amount,
    call,
  };
}

function decodeCall(data: Buffer, offset: number): any {
  const ty = data[offset];
  offset += 1;
  const to = data.subarray(offset, offset + 20);
  offset += 20;
  const value = BigInt('0x' + data.subarray(offset, offset + 16).reverse().toString('hex'));
  offset += 16;
  const dataLen = data.readUInt32LE(offset);
  offset += 4;
  const callData = data.subarray(offset, offset + dataLen);

  return { ty, to: `0x${Buffer.from(to).toString('hex')}`, value, data: `0x${Buffer.from(callData).toString('hex')}` };
}

function buildEvmMessage(outgoingMessagePubkey: string, outgoing: OutgoingMessageData) {
  const nonce = outgoing.nonce;
  const senderBytes32 = pubkeyToBytes32(outgoing.sender);
  const { ty, data } = buildIncomingPayload(outgoing);

  const innerHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes' }],
      [senderBytes32, ty, data]
    )
  );

  const pubkeyBytes32 = pubkeyToBytes32(outgoingMessagePubkey);
  const outerHash = keccak256(
    encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [nonce, pubkeyBytes32, innerHash]
    )
  );

  return { innerHash, outerHash, evmMessage: { outgoingMessagePubkey: pubkeyBytes32, gasLimit: BigInt(100000), nonce, sender: senderBytes32, ty, data } };
}

function pubkeyToBytes32(pubkey: string): Hex {
  const bytes = new PublicKey(pubkey).toBytes();
  let hex = toHex(bytes);
  return hex.length !== 66 ? padHex(hex, { size: 32 }) : hex;
}

function buildIncomingPayload(outgoing: OutgoingMessageData): { ty: number; data: Hex } {
  const msg = outgoing.message;

  if (msg.__kind === 'Transfer') {
    const transfer = msg.fields[0];
    const transferTuple = {
      localToken: transfer.remoteToken as `0x${string}`,
      remoteToken: pubkeyToBytes32(transfer.localToken),
      to: padHex(transfer.to as `0x${string}`, { size: 32, dir: 'right' }),
      remoteAmount: transfer.amount,
    } as const;

    const encodedTransfer = encodeAbiParameters(
      [{
        type: 'tuple', components: [
          { name: 'localToken', type: 'address' },
          { name: 'remoteToken', type: 'bytes32' },
          { name: 'to', type: 'bytes32' },
          { name: 'remoteAmount', type: 'uint64' },
        ]
      }],
      [transferTuple]
    );

    if (!transfer.call) return { ty: 1, data: encodedTransfer };

    const callTuple = { ty: transfer.call.ty, to: transfer.call.to as `0x${string}`, value: transfer.call.value, data: transfer.call.data as `0x${string}` };
    const data = encodeAbiParameters(
      [
        {
          type: 'tuple', components: [
            { name: 'localToken', type: 'address' },
            { name: 'remoteToken', type: 'bytes32' },
            { name: 'to', type: 'bytes32' },
            { name: 'remoteAmount', type: 'uint64' },
          ]
        },
        {
          type: 'tuple', components: [
            { name: 'ty', type: 'uint8' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint128' },
            { name: 'data', type: 'bytes' },
          ]
        },
      ],
      [transferTuple, callTuple]
    );
    return { ty: 2, data };
  }

  throw new Error('Unsupported message type');
}

