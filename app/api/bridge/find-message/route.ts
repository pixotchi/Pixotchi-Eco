/**
 * Find Bridge Outgoing Message API
 * 
 * Finds the OutgoingMessage pubkey from a Solana transaction signature.
 * Call: GET /api/bridge/find-message?tx=<solana_tx_signature>
 */

import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

// Solana Bridge Program on Mainnet
const BRIDGE_PROGRAM_ID = 'HNCne2FkVaNghhjKXapxJzPaBvAKDG1Ge3gqhZyfVWLM';

// OutgoingMessage account discriminator (first 8 bytes)
// From: bridge-main/clients/ts/src/bridge/generated/accounts/outgoingMessage.ts
const OUTGOING_MESSAGE_DISCRIMINATOR = [150, 255, 197, 226, 200, 215, 31, 29];

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const txSignature = searchParams.get('tx');

  if (!txSignature) {
    return NextResponse.json({ 
      error: 'Missing tx parameter',
      usage: 'GET /api/bridge/find-message?tx=<solana_transaction_signature>'
    }, { status: 400 });
  }

  try {
    const connection = new Connection(SOLANA_RPC);
    
    // Get the transaction
    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return NextResponse.json({ 
        error: 'Transaction not found',
        tx: txSignature,
        hint: 'Make sure this is a valid Solana mainnet transaction signature'
      }, { status: 404 });
    }

    // Check if this transaction involves the bridge program
    const bridgeProgramIndex = tx.transaction.message.accountKeys.findIndex(
      key => key.pubkey.toBase58() === BRIDGE_PROGRAM_ID
    );

    if (bridgeProgramIndex === -1) {
      return NextResponse.json({ 
        error: 'This transaction does not involve the Base-Solana bridge',
        tx: txSignature,
        bridgeProgram: BRIDGE_PROGRAM_ID,
        hint: 'Make sure this is a bridge_sol transaction'
      }, { status: 400 });
    }

    // Find accounts created by this transaction that belong to the bridge program
    const postBalances = tx.meta?.postBalances || [];
    const preBalances = tx.meta?.preBalances || [];
    const accountKeys = tx.transaction.message.accountKeys;

    const createdAccounts: string[] = [];
    
    for (let i = 0; i < accountKeys.length; i++) {
      // Account was created if pre-balance was 0 and post-balance > 0
      if (preBalances[i] === 0 && postBalances[i] > 0) {
        createdAccounts.push(accountKeys[i].pubkey.toBase58());
      }
    }

    // Check which created accounts are OutgoingMessage accounts
    const outgoingMessages: Array<{
      pubkey: string;
      nonce: string;
      sender: string;
    }> = [];

    for (const pubkey of createdAccounts) {
      try {
        const accountInfo = await connection.getAccountInfo(new PublicKey(pubkey));
        
        if (!accountInfo) continue;
        
        // Check if owner is bridge program
        if (accountInfo.owner.toBase58() !== BRIDGE_PROGRAM_ID) continue;
        
        // Check discriminator
        const discriminator = Array.from(accountInfo.data.slice(0, 8));
        const isOutgoingMessage = discriminator.every((byte, i) => byte === OUTGOING_MESSAGE_DISCRIMINATOR[i]);
        
        if (isOutgoingMessage) {
          // Decode basic info
          const nonce = BigInt('0x' + Buffer.from(accountInfo.data.slice(8, 16)).reverse().toString('hex'));
          const sender = new PublicKey(accountInfo.data.slice(16, 48)).toBase58();
          
          outgoingMessages.push({
            pubkey,
            nonce: nonce.toString(),
            sender,
          });
        }
      } catch {
        // Skip accounts we can't read
      }
    }

    if (outgoingMessages.length === 0) {
      return NextResponse.json({
        error: 'No OutgoingMessage account found in this transaction',
        tx: txSignature,
        createdAccounts,
        hint: 'This might not be a bridge_sol transaction, or the message account may have been closed'
      }, { status: 404 });
    }

    const message = outgoingMessages[0];

    return NextResponse.json({
      success: true,
      tx: txSignature,
      outgoingMessage: message,
      // Provide direct link to diagnostic
      diagnosticUrl: `/api/bridge/diagnose?pubkey=${message.pubkey}`,
      explorerUrl: `https://explorer.solana.com/tx/${txSignature}`,
      hint: `Use the pubkey "${message.pubkey}" with the diagnose API to check bridge status`
    });

  } catch (error) {
    console.error('Find message error:', error);
    return NextResponse.json({ 
      error: 'Failed to analyze transaction', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

