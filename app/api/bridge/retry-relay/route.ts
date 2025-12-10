/**
 * Retry Bridge Relay API
 * 
 * Retries a failed bridge message with higher gas limit.
 * This is a READ-ONLY endpoint that returns the transaction data for manual execution.
 * 
 * GET /api/bridge/retry-relay?pubkey=<outgoingMessagePubkey>&gasLimit=<optional_gas_limit>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, keccak256, encodeAbiParameters, toHex, padHex, encodeFunctionData, type Hex, type Address } from 'viem';
import { base } from 'viem/chains';
import { Connection, PublicKey } from '@solana/web3.js';

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const BRIDGE_CONTRACT = '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188' as Address;
const BRIDGE_VALIDATOR = '0xAF24c1c24Ff3BF1e6D882518120fC25442d6794B' as Address;

// Full relayMessages ABI
const BRIDGE_ABI = [
  {
    name: 'relayMessages',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'messages',
      type: 'tuple[]',
      components: [
        { name: 'outgoingMessagePubkey', type: 'bytes32' },
        { name: 'nonce', type: 'uint64' },
        { name: 'sender', type: 'bytes32' },
        { name: 'gasLimit', type: 'uint64' },
        { name: 'ty', type: 'uint8' },
        { name: 'data', type: 'bytes' },
      ],
    }],
    outputs: [],
  },
  { name: 'successes', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { name: 'failures', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

const VALIDATOR_ABI = [
  { name: 'validMessages', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pubkey = searchParams.get('pubkey');
  const gasLimitParam = searchParams.get('gasLimit');

  if (!pubkey) {
    return NextResponse.json({ error: 'Missing pubkey parameter' }, { status: 400 });
  }

  // Default to 500k gas, allow override up to 2M
  const gasLimit = Math.min(
    gasLimitParam ? parseInt(gasLimitParam) : 500000,
    2000000
  );

  try {
    // Fetch the OutgoingMessage from Solana
    const connection = new Connection(SOLANA_RPC);
    const accountInfo = await connection.getAccountInfo(new PublicKey(pubkey));

    if (!accountInfo) {
      return NextResponse.json({ error: 'OutgoingMessage not found on Solana' }, { status: 404 });
    }

    const outgoingMessage = decodeOutgoingMessage(accountInfo.data);
    const { outerHash, evmMessage } = buildEvmMessage(pubkey, outgoingMessage, BigInt(gasLimit));

    // Check current status on Base
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    const [isValidated, isSuccess, isFailed] = await Promise.all([
      publicClient.readContract({
        address: BRIDGE_VALIDATOR,
        abi: VALIDATOR_ABI,
        functionName: 'validMessages',
        args: [outerHash as `0x${string}`],
      }),
      publicClient.readContract({
        address: BRIDGE_CONTRACT,
        abi: BRIDGE_ABI,
        functionName: 'successes',
        args: [outerHash as `0x${string}`],
      }),
      publicClient.readContract({
        address: BRIDGE_CONTRACT,
        abi: BRIDGE_ABI,
        functionName: 'failures',
        args: [outerHash as `0x${string}`],
      }),
    ]);

    if (isSuccess) {
      return NextResponse.json({
        error: 'Message already executed successfully',
        messageHash: outerHash,
        hint: 'Check your wSOL balance on Base'
      }, { status: 400 });
    }

    if (!isValidated) {
      return NextResponse.json({
        error: 'Message not validated yet',
        messageHash: outerHash,
        hint: 'Wait for validators to approve the message first'
      }, { status: 400 });
    }

    // Build the transaction calldata
    const calldata = encodeFunctionData({
      abi: BRIDGE_ABI,
      functionName: 'relayMessages',
      args: [[{
        outgoingMessagePubkey: evmMessage.outgoingMessagePubkey as `0x${string}`,
        nonce: evmMessage.nonce,
        sender: evmMessage.sender as `0x${string}`,
        gasLimit: evmMessage.gasLimit,
        ty: evmMessage.ty,
        data: evmMessage.data as `0x${string}`,
      }]],
    });

    return NextResponse.json({
      status: isFailed ? 'READY_TO_RETRY' : 'READY_TO_EXECUTE',
      previouslyFailed: isFailed,
      messageHash: outerHash,
      gasLimit,
      transaction: {
        to: BRIDGE_CONTRACT,
        data: calldata,
        // Suggest gas limit for the transaction itself (not the inner message execution)
        suggestedGas: gasLimit + 100000, // Add overhead for relayMessages wrapper
      },
      message: {
        outgoingMessagePubkey: evmMessage.outgoingMessagePubkey,
        nonce: evmMessage.nonce.toString(),
        sender: evmMessage.sender,
        innerGasLimit: gasLimit,
        type: evmMessage.ty,
      },
      instructions: [
        'Copy the transaction data below',
        'Use your wallet (MetaMask, etc.) or cast to send:',
        `cast send ${BRIDGE_CONTRACT} "${calldata}" --gas-limit ${gasLimit + 100000}`,
        'Or use the Basescan write contract UI with the calldata'
      ],
    });

  } catch (error) {
    console.error('Retry relay error:', error);
    return NextResponse.json({ 
      error: 'Failed to prepare retry transaction', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

// Helper functions (same as diagnose route)
interface OutgoingMessageData {
  nonce: bigint;
  sender: string;
  message: { __kind: 'Call' | 'Transfer'; fields: any[] };
}

function decodeOutgoingMessage(data: Buffer): OutgoingMessageData {
  let offset = 8;
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
  return { to: `0x${Buffer.from(to).toString('hex')}`, localToken, remoteToken: `0x${Buffer.from(remoteToken).toString('hex')}`, amount, call };
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

function buildEvmMessage(outgoingMessagePubkey: string, outgoing: OutgoingMessageData, gasLimit: bigint) {
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

  return { 
    innerHash, 
    outerHash, 
    evmMessage: { 
      outgoingMessagePubkey: pubkeyBytes32, 
      gasLimit, 
      nonce, 
      sender: senderBytes32, 
      ty, 
      data 
    } 
  };
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
      [{ type: 'tuple', components: [
        { name: 'localToken', type: 'address' },
        { name: 'remoteToken', type: 'bytes32' },
        { name: 'to', type: 'bytes32' },
        { name: 'remoteAmount', type: 'uint64' },
      ]}],
      [transferTuple]
    );

    if (!transfer.call) return { ty: 1, data: encodedTransfer };

    const callTuple = { ty: transfer.call.ty, to: transfer.call.to as `0x${string}`, value: transfer.call.value, data: transfer.call.data as `0x${string}` };
    const data = encodeAbiParameters(
      [
        { type: 'tuple', components: [
          { name: 'localToken', type: 'address' },
          { name: 'remoteToken', type: 'bytes32' },
          { name: 'to', type: 'bytes32' },
          { name: 'remoteAmount', type: 'uint64' },
        ]},
        { type: 'tuple', components: [
          { name: 'ty', type: 'uint8' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint128' },
          { name: 'data', type: 'bytes' },
        ]},
      ],
      [transferTuple, callTuple]
    );
    return { ty: 2, data };
  }
  
  if (msg.__kind === 'Call') {
    const call = msg.fields[0];
    const data = encodeAbiParameters(
      [{ type: 'tuple', components: [
        { name: 'ty', type: 'uint8' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint128' },
        { name: 'data', type: 'bytes' },
      ]}],
      [{ ty: call.ty, to: call.to as `0x${string}`, value: call.value, data: call.data as `0x${string}` }]
    );
    return { ty: 0, data };
  }
  
  throw new Error('Unsupported message type');
}

