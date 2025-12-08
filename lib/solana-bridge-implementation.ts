/**
 * Solana Bridge Implementation
 * Handles building and submitting bridge transactions from Solana to Base
 * Based on the Base-Solana bridge protocol
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { parseUnits } from 'viem';

// ============ Types ============

export type ContractCallType = 'call' | 'delegatecall' | 'create' | 'create2';

export interface BaseContractCall {
  type: ContractCallType;
  target?: string;
  value?: string;
  data?: string;
}

export interface BridgeAssetDetails {
  symbol: string;
  label: string;
  type: 'sol' | 'spl';
  decimals: number;
  remoteAddress: string;
  mint?: PublicKey;
  tokenProgram?: PublicKey;
}

interface CreateBridgeTransactionParams {
  walletAddress: PublicKey;
  destinationAddress: string;
  amount: bigint;
  asset: BridgeAssetDetails;
  tokenAccount?: PublicKey;
  call?: BaseContractCall;
  gasLimit?: bigint;
}

// ============ Constants ============

// Base Mainnet Bridge Configuration
export const SOLANA_MAINNET_CONFIG = {
  name: 'Solana Mainnet',
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  blockExplorer: 'https://explorer.solana.com',
  solanaBridge: new PublicKey('HNCne2FkVaNghhjKXapxJzPaBvAKDG1Ge3gqhZyfVWLM'),
  baseRelayerProgram: new PublicKey('g1et5VenhfJHJwsdJsDbxWZuotD5H4iELNG61kS4fb9'),
  gasFeeReceiver: new PublicKey('4m2jaKbJ4pDZw177BmLPMLsztPF5eVFo2fvxPgajdBNz'),
};

export const BASE_MAINNET_CONFIG = {
  chainId: 8453,
  name: 'Base Mainnet',
  rpcUrl: 'https://mainnet.base.org',
  blockExplorer: 'https://basescan.org',
  bridge: '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188',
  bridgeValidator: '0xAF24c1c24Ff3BF1e6D882518120fC25442d6794B',
  crossChainFactory: '0xDD56781d0509650f8C2981231B6C917f2d5d7dF2',
  relayerOrchestrator: '0x8Cfa6F29930E6310B6074baB0052c14a709B4741',
  wrappedSOL: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82',
};

// Standard gas limit for bridge operations
export const DEFAULT_GAS_LIMIT = BigInt(200000);

// ============ Browser-Compatible Buffer Helpers ============

/**
 * Write a BigInt as little-endian 64-bit unsigned integer to a Uint8Array
 */
function writeBigUInt64LE(buffer: Uint8Array, value: bigint, offset: number): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(offset, value, true); // true = little endian
}

/**
 * Copy bytes from source to destination at offset
 */
function copyBytes(dest: Uint8Array, src: Uint8Array, destOffset: number): void {
  dest.set(src, destOffset);
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert string to UTF-8 bytes
 */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============ PDA Derivation Helpers ============

function normalizeSalt(salt: Uint8Array | string): Uint8Array {
  if (typeof salt === 'string') {
    const h = salt.startsWith('0x') ? salt.slice(2) : salt;
    if (h.length !== 64) throw new Error(`salt hex must be 32 bytes (64 hex chars). got ${h.length}`);
    return hexToBytes(h);
  }
  if (salt.length !== 32) throw new Error(`salt must be 32 bytes. got ${salt.length}`);
  return new Uint8Array(salt);
}

function deriveOutgoingMessagePda(
  salt: Uint8Array | string,
  bridgeProgramId: PublicKey
): PublicKey {
  const s = normalizeSalt(salt);
  const [pda] = PublicKey.findProgramAddressSync(
    [stringToBytes('outgoing_message'), s],
    bridgeProgramId
  );
  return pda;
}

function deriveMessageToRelayPda(
  salt: Uint8Array | string,
  relayerProgramId: PublicKey
): PublicKey {
  const s = normalizeSalt(salt);
  const [pda] = PublicKey.findProgramAddressSync(
    [stringToBytes('mtr'), s],
    relayerProgramId
  );
  return pda;
}

// ============ Bridge Implementation ============

/**
 * Real Bridge Implementation using standard Solana libraries
 * Implements the actual bridge instructions for Solana Mainnet → Base Mainnet
 */
export class SolanaBridgeImplementation {
  private connection: Connection;
  private bridgeProgramId: PublicKey;
  private baseRelayerProgramId: PublicKey;
  private gasFeeReceiver: PublicKey;
  
  private static readonly CALL_TYPE_INDEX: Record<ContractCallType, number> = {
    call: 0,
    delegatecall: 1,
    create: 2,
    create2: 3,
  };

  constructor() {
    this.connection = new Connection(SOLANA_MAINNET_CONFIG.rpcUrl, 'confirmed');
    this.bridgeProgramId = SOLANA_MAINNET_CONFIG.solanaBridge;
    this.baseRelayerProgramId = SOLANA_MAINNET_CONFIG.baseRelayerProgram;
    this.gasFeeReceiver = SOLANA_MAINNET_CONFIG.gasFeeReceiver;
  }

  /**
   * Update the RPC connection URL
   */
  setRpcUrl(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get the current connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Create a bridge transaction for SOL
   */
  async createBridgeTransaction(params: CreateBridgeTransactionParams): Promise<Transaction> {
    if (params.asset.type === 'sol') {
      return this.buildSolBridgeTransaction(params);
    }
    return this.buildSplBridgeTransaction(params);
  }

  private createSaltBundle() {
    const salt32 = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(salt32);
    } else {
      // Fallback for server-side
      for (let i = 0; i < 32; i++) {
        salt32[i] = Math.floor(Math.random() * 256);
      }
    }
    const saltBuffer = normalizeSalt(salt32);

    return {
      saltBuffer,
      outgoingMessagePda: deriveOutgoingMessagePda(saltBuffer, this.bridgeProgramId),
      messageToRelayPda: deriveMessageToRelayPda(saltBuffer, this.baseRelayerProgramId),
    };
  }

  private async buildSolBridgeTransaction({
    walletAddress,
    amount,
    destinationAddress,
    asset,
    call,
    gasLimit,
  }: CreateBridgeTransactionParams): Promise<Transaction> {
    console.log(`[SolanaBridge] Creating bridge transaction: ${asset.symbol.toUpperCase()} → ${destinationAddress}`);

    try {
      const [bridgeAddress] = PublicKey.findProgramAddressSync(
        [stringToBytes('bridge')],
        this.bridgeProgramId
      );

      const [solVaultAddress] = PublicKey.findProgramAddressSync(
        [stringToBytes('sol_vault')],
        this.bridgeProgramId
      );

      const { saltBuffer, outgoingMessagePda, messageToRelayPda } = this.createSaltBundle();

      // Use provided gas limit or default
      const effectiveGasLimit = gasLimit || DEFAULT_GAS_LIMIT;

      console.log('[SolanaBridge] Bridge params:', {
        salt32: `0x${bytesToHex(saltBuffer)}`,
        outgoingMessagePDA: outgoingMessagePda.toBase58(),
        messageToRelayPDA: messageToRelayPda.toBase58(),
        to: destinationAddress.toLowerCase(),
        remoteToken: asset.remoteAddress,
        gasLimit: effectiveGasLimit.toString(),
      });

      const bridgeAccountInfo = await this.connection.getAccountInfo(bridgeAddress);
      if (!bridgeAccountInfo) {
        throw new Error('Bridge account not found. The bridge may not be initialized on Solana Mainnet.');
      }

      const [cfgAddress] = PublicKey.findProgramAddressSync(
        [stringToBytes('config')],
        this.baseRelayerProgramId
      );

      const transaction = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = walletAddress;

      try {
        const cfgAccountInfo = await this.connection.getAccountInfo(cfgAddress);
        if (!cfgAccountInfo) {
          console.log('[SolanaBridge] Relayer config account does not exist, using fallback');
          throw new Error('Base relayer config account not found');
        }

        // Add PayForRelay instruction
        const relayInstruction = this.createPayForRelayInstruction({
          payer: walletAddress,
          cfg: cfgAddress,
          gasFeeReceiver: this.gasFeeReceiver,
          messageToRelay: messageToRelayPda,
          messageToRelaySalt: saltBuffer,
          systemProgram: SystemProgram.programId,
          outgoingMessage: outgoingMessagePda,
          gasLimit: effectiveGasLimit,
        });

        // Add bridge_sol instruction
        const bridgeInstruction = this.createBridgeSolInstruction({
          payer: walletAddress,
          from: walletAddress,
          gasFeeReceiver: this.gasFeeReceiver,
          solVault: solVaultAddress,
          bridge: bridgeAddress,
          outgoingMessage: outgoingMessagePda,
          outgoingMessageSalt: saltBuffer,
          systemProgram: SystemProgram.programId,
          to: destinationAddress,
          amount,
          call,
        });

        // CRITICAL: Order matters. PayForRelay must come BEFORE bridge_sol.
        transaction.add(relayInstruction);
        transaction.add(bridgeInstruction);
      } catch (error) {
        console.error('[SolanaBridge] Error with relay payment, falling back to bridge-only:', error);

        // Fallback: bridge without auto-relay
        const fallbackBridgeInstruction = this.createBridgeSolInstruction({
          payer: walletAddress,
          from: walletAddress,
          gasFeeReceiver: this.gasFeeReceiver,
          solVault: solVaultAddress,
          bridge: bridgeAddress,
          outgoingMessage: outgoingMessagePda,
          outgoingMessageSalt: saltBuffer,
          systemProgram: SystemProgram.programId,
          to: destinationAddress,
          amount,
          call,
        });

        transaction.add(fallbackBridgeInstruction);
      }

      return transaction;
    } catch (error) {
      console.error('[SolanaBridge] Error creating bridge transaction:', error);
      throw error;
    }
  }

  private async buildSplBridgeTransaction({
    walletAddress,
    destinationAddress,
    amount,
    asset,
    tokenAccount,
    call,
    gasLimit,
  }: CreateBridgeTransactionParams): Promise<Transaction> {
    if (!asset.mint) {
      throw new Error('SPL asset is missing a mint address.');
    }

    if (!tokenAccount) {
      throw new Error('Token account is required for SPL bridging.');
    }

    console.log(`[SolanaBridge] Creating SPL bridge transaction: ${asset.symbol.toUpperCase()} → ${destinationAddress}`);

    try {
      const [bridgeAddress] = PublicKey.findProgramAddressSync(
        [stringToBytes('bridge')],
        this.bridgeProgramId
      );

      const remoteTokenBytes = this.addressToBytes20(asset.remoteAddress);
      const [tokenVaultAddress] = PublicKey.findProgramAddressSync(
        [stringToBytes('token_vault'), asset.mint.toBytes(), remoteTokenBytes],
        this.bridgeProgramId
      );

      const { saltBuffer, outgoingMessagePda, messageToRelayPda } = this.createSaltBundle();

      // Use provided gas limit or default
      const effectiveGasLimit = gasLimit || DEFAULT_GAS_LIMIT;

      const bridgeAccountInfo = await this.connection.getAccountInfo(bridgeAddress);
      if (!bridgeAccountInfo) {
        throw new Error('Bridge account not found.');
      }

      const [cfgAddress] = PublicKey.findProgramAddressSync(
        [stringToBytes('config')],
        this.baseRelayerProgramId
      );

      const transaction = new Transaction();
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = walletAddress;

      try {
        const cfgAccountInfo = await this.connection.getAccountInfo(cfgAddress);
        if (!cfgAccountInfo) {
          throw new Error('Base relayer config account not found.');
        }

        const relayInstruction = this.createPayForRelayInstruction({
          payer: walletAddress,
          cfg: cfgAddress,
          gasFeeReceiver: this.gasFeeReceiver,
          messageToRelay: messageToRelayPda,
          messageToRelaySalt: saltBuffer,
          systemProgram: SystemProgram.programId,
          outgoingMessage: outgoingMessagePda,
          gasLimit: effectiveGasLimit,
        });

        const bridgeInstruction = this.createBridgeSplInstruction({
          payer: walletAddress,
          from: walletAddress,
          gasFeeReceiver: this.gasFeeReceiver,
          mint: asset.mint,
          fromTokenAccount: tokenAccount,
          tokenVault: tokenVaultAddress,
          bridge: bridgeAddress,
          outgoingMessage: outgoingMessagePda,
          outgoingMessageSalt: saltBuffer,
          systemProgram: SystemProgram.programId,
          tokenProgram: asset.tokenProgram ?? TOKEN_PROGRAM_ID,
          to: destinationAddress,
          remoteToken: asset.remoteAddress,
          amount,
          call,
        });

        // CRITICAL: Order matters. PayForRelay must come BEFORE bridge_spl.
        transaction.add(relayInstruction);
        transaction.add(bridgeInstruction);
      } catch (error) {
        console.error('[SolanaBridge] Error with relay payment, falling back:', error);

        const fallbackBridgeInstruction = this.createBridgeSplInstruction({
          payer: walletAddress,
          from: walletAddress,
          gasFeeReceiver: this.gasFeeReceiver,
          mint: asset.mint,
          fromTokenAccount: tokenAccount,
          tokenVault: tokenVaultAddress,
          bridge: bridgeAddress,
          outgoingMessage: outgoingMessagePda,
          outgoingMessageSalt: saltBuffer,
          systemProgram: SystemProgram.programId,
          tokenProgram: asset.tokenProgram ?? TOKEN_PROGRAM_ID,
          to: destinationAddress,
          remoteToken: asset.remoteAddress,
          amount,
          call,
        });

        transaction.add(fallbackBridgeInstruction);
      }

      return transaction;
    } catch (error) {
      console.error('[SolanaBridge] Error creating SPL bridge transaction:', error);
      throw error;
    }
  }

  /**
   * Create pay_for_relay instruction
   */
  private createPayForRelayInstruction({
    payer,
    cfg,
    gasFeeReceiver,
    messageToRelay,
    messageToRelaySalt,
    systemProgram,
    outgoingMessage,
    gasLimit,
  }: {
    payer: PublicKey;
    cfg: PublicKey;
    gasFeeReceiver: PublicKey;
    messageToRelay: PublicKey;
    messageToRelaySalt: Uint8Array;
    systemProgram: PublicKey;
    outgoingMessage: PublicKey;
    gasLimit: bigint;
  }): TransactionInstruction {
    // pay_for_relay discriminator
    const discriminator = new Uint8Array([41, 191, 218, 201, 250, 164, 156, 55]);

    // Instruction data: discriminator + mtrSalt + outgoingMessage + gasLimit
    const data = new Uint8Array(8 + 32 + 32 + 8);
    let offset = 0;

    copyBytes(data, discriminator, offset);
    offset += 8;

    copyBytes(data, messageToRelaySalt, offset);
    offset += 32;

    const outgoingMessageBytes = outgoingMessage.toBytes();
    copyBytes(data, outgoingMessageBytes, offset);
    offset += 32;

    writeBigUInt64LE(data, gasLimit, offset);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: cfg, isSigner: false, isWritable: true },
      { pubkey: gasFeeReceiver, isSigner: false, isWritable: true },
      { pubkey: messageToRelay, isSigner: false, isWritable: true },
      { pubkey: systemProgram, isSigner: false, isWritable: false },
    ];

    // Convert Uint8Array to Buffer for TransactionInstruction compatibility
    const dataBuffer = Buffer.from(data);
    
    console.log('[SolanaBridge] createPayForRelayInstruction data:', {
      dataLength: dataBuffer.length,
      gasLimit: gasLimit.toString(),
    });

    return new TransactionInstruction({
      keys,
      programId: this.baseRelayerProgramId,
      data: dataBuffer,
    });
  }

  /**
   * Create bridge_sol instruction
   */
  private createBridgeSolInstruction({
    payer,
    from,
    gasFeeReceiver,
    solVault,
    bridge,
    outgoingMessage,
    outgoingMessageSalt,
    systemProgram,
    to,
    amount,
    call,
  }: {
    payer: PublicKey;
    from: PublicKey;
    gasFeeReceiver: PublicKey;
    solVault: PublicKey;
    bridge: PublicKey;
    outgoingMessage: PublicKey;
    outgoingMessageSalt: Uint8Array;
    systemProgram: PublicKey;
    to: string;
    amount: bigint;
    call?: BaseContractCall;
  }): TransactionInstruction {
    const discriminator = new Uint8Array([190, 190, 32, 158, 75, 153, 32, 86]);

    const toBytes = this.addressToBytes20(to);
    const callBuffer = this.serializeOptionalCall(call);

    // Instruction data: discriminator + salt + to + amount + call_option
    const data = new Uint8Array(8 + 32 + 20 + 8 + callBuffer.length);
    let offset = 0;

    copyBytes(data, discriminator, offset);
    offset += 8;

    copyBytes(data, outgoingMessageSalt, offset);
    offset += 32;

    copyBytes(data, toBytes, offset);
    offset += 20;

    writeBigUInt64LE(data, amount, offset);
    offset += 8;

    copyBytes(data, callBuffer, offset);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: gasFeeReceiver, isSigner: false, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: bridge, isSigner: false, isWritable: true },
      { pubkey: outgoingMessage, isSigner: false, isWritable: true },
      { pubkey: systemProgram, isSigner: false, isWritable: false },
    ];

    // Convert Uint8Array to Buffer for TransactionInstruction compatibility
    const dataBuffer = Buffer.from(data);
    
    console.log('[SolanaBridge] createBridgeSolInstruction data:', {
      dataLength: dataBuffer.length,
      callBufferLength: callBuffer.length,
    });

    return new TransactionInstruction({
      keys,
      programId: this.bridgeProgramId,
      data: dataBuffer,
    });
  }

  private createBridgeSplInstruction({
    payer,
    from,
    gasFeeReceiver,
    mint,
    fromTokenAccount,
    tokenVault,
    bridge,
    outgoingMessage,
    outgoingMessageSalt,
    systemProgram,
    tokenProgram,
    to,
    remoteToken,
    amount,
    call,
  }: {
    payer: PublicKey;
    from: PublicKey;
    gasFeeReceiver: PublicKey;
    mint: PublicKey;
    fromTokenAccount: PublicKey;
    tokenVault: PublicKey;
    bridge: PublicKey;
    outgoingMessage: PublicKey;
    outgoingMessageSalt: Uint8Array;
    systemProgram: PublicKey;
    tokenProgram: PublicKey;
    to: string;
    remoteToken: string;
    amount: bigint;
    call?: BaseContractCall;
  }): TransactionInstruction {
    const discriminator = new Uint8Array([87, 109, 172, 103, 8, 187, 223, 126]);

    const toBytes = this.addressToBytes20(to);
    const remoteTokenBytes = this.addressToBytes20(remoteToken);
    const callBuffer = this.serializeOptionalCall(call);

    // Instruction data: discriminator + salt + to + remote_token + amount + call_option
    const data = new Uint8Array(8 + 32 + 20 + 20 + 8 + callBuffer.length);
    let offset = 0;

    copyBytes(data, discriminator, offset);
    offset += 8;

    copyBytes(data, outgoingMessageSalt, offset);
    offset += 32;

    copyBytes(data, toBytes, offset);
    offset += 20;

    copyBytes(data, remoteTokenBytes, offset);
    offset += 20;

    writeBigUInt64LE(data, amount, offset);
    offset += 8;

    copyBytes(data, callBuffer, offset);

    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: gasFeeReceiver, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: fromTokenAccount, isSigner: false, isWritable: true },
      { pubkey: bridge, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: outgoingMessage, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: systemProgram, isSigner: false, isWritable: false },
    ];

    // Convert Uint8Array to Buffer for TransactionInstruction compatibility
    const dataBuffer = Buffer.from(data);

    return new TransactionInstruction({
      keys,
      programId: this.bridgeProgramId,
      data: dataBuffer,
    });
  }

  /**
   * Convert Ethereum address to 20-byte Uint8Array
   */
  private addressToBytes20(address: string): Uint8Array {
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;

    if (cleanAddress.length !== 40) {
      throw new Error(`Invalid Ethereum address length: expected 40 hex chars, got ${cleanAddress.length}`);
    }

    if (!/^[0-9a-fA-F]{40}$/.test(cleanAddress)) {
      throw new Error('Invalid Ethereum address format: contains non-hex characters');
    }

    return hexToBytes(cleanAddress);
  }

  private serializeOptionalCall(call?: BaseContractCall): Uint8Array {
    if (!call) {
      return new Uint8Array([0]);
    }

    const normalizedType = call.type.toLowerCase() as ContractCallType;
    const discriminator = SolanaBridgeImplementation.CALL_TYPE_INDEX[normalizedType];

    if (discriminator === undefined) {
      throw new Error(`Unsupported call type "${call.type}". Use call | delegatecall | create | create2.`);
    }

    if ((normalizedType === 'call' || normalizedType === 'delegatecall') && !call.target) {
      throw new Error('callTarget is required for call and delegatecall operations.');
    }

    const targetBuffer =
      normalizedType === 'create' || normalizedType === 'create2'
        ? new Uint8Array(20)
        : this.addressToBytes20((call.target as string).toLowerCase());

    const valueBuffer = new Uint8Array(16);
    this.writeUint128LE(this.parseCallValue(call.value), valueBuffer);

    const payload = this.hexToUint8Array(call.data ?? '0x');
    const payloadLength = new Uint8Array(4);
    new DataView(payloadLength.buffer).setUint32(0, payload.length, true);

    // Concatenate all parts
    const result = new Uint8Array(2 + 20 + 16 + 4 + payload.length);
    let offset = 0;
    result[offset++] = 1;
    result[offset++] = discriminator;
    copyBytes(result, targetBuffer, offset);
    offset += 20;
    copyBytes(result, valueBuffer, offset);
    offset += 16;
    copyBytes(result, payloadLength, offset);
    offset += 4;
    copyBytes(result, payload, offset);

    return result;
  }

  private parseCallValue(value?: string): bigint {
    if (!value || value.trim().length === 0) {
      return BigInt(0);
    }

    try {
      const parsed = parseUnits(value, 18);
      const max = (BigInt(1) << BigInt(128)) - BigInt(1);
      if (parsed > max) {
        throw new Error('Call value exceeds 128-bit limit.');
      }
      return parsed;
    } catch {
      throw new Error(`Invalid call value "${value}". Provide a decimal ETH amount.`);
    }
  }

  private writeUint128LE(value: bigint, buffer: Uint8Array) {
    if (buffer.length < 16) {
      throw new Error('Uint128 buffer must have at least 16 bytes.');
    }

    let temp = value;
    for (let i = 0; i < 16; i += 1) {
      buffer[i] = Number(temp & BigInt(0xff));
      temp >>= BigInt(8);
    }
  }

  private hexToUint8Array(value: string): Uint8Array {
    if (!value) {
      return new Uint8Array(0);
    }

    const clean = value.startsWith('0x') ? value.slice(2) : value;
    if (clean.length === 0) {
      return new Uint8Array(0);
    }

    if (clean.length % 2 !== 0) {
      throw new Error('Hex data must have an even number of characters.');
    }

    if (!/^[0-9a-fA-F]+$/.test(clean)) {
      throw new Error('Hex data contains invalid characters.');
    }

    return hexToBytes(clean);
  }

  /**
   * Submit bridge transaction
   * @param transaction The transaction to submit
   * @param walletAddress The wallet address (for reference)
   * @param signTransaction Function to sign the transaction (from Privy)
   */
  async submitBridgeTransaction(
    transaction: Transaction,
    walletAddress: PublicKey,
    signTransaction: (transaction: Transaction) => Promise<Transaction>
  ): Promise<string> {
    // Sign the transaction with the user's wallet
    const signedTransaction = await signTransaction(transaction);

    const serialized = signedTransaction.serialize();

    // Extract signature from the signed transaction
    const primarySignature = signedTransaction.signatures[0]?.signature
      ? this.encodeBase58(signedTransaction.signatures[0].signature as Uint8Array)
      : undefined;

    let signature: string | undefined;

    try {
      // Send the signed transaction
      signature = await this.connection.sendRawTransaction(serialized, {
        skipPreflight: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const isAlreadyProcessed = message.includes('already been processed');

      if (isAlreadyProcessed && primarySignature) {
        console.warn('[SolanaBridge] Transaction already processed, reusing existing signature');
        signature = primarySignature;
      } else {
        throw error;
      }
    }

    if (!signature) {
      if (primarySignature) {
        signature = primarySignature;
      } else {
        throw new Error('Unable to determine transaction signature');
      }
    }

    // Confirm transaction
    await this.connection.confirmTransaction(signature, 'confirmed');

    return signature;
  }

  /**
   * Encode bytes to base58
   */
  private encodeBase58(bytes: Buffer | Uint8Array): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const base = 58;
    
    // Convert bytes to bigint
    let num = BigInt(0);
    for (const byte of bytes) {
      num = num * BigInt(256) + BigInt(byte);
    }
    
    // Convert to base58
    let result = '';
    while (num > 0) {
      result = ALPHABET[Number(num % BigInt(base))] + result;
      num = num / BigInt(base);
    }
    
    // Add leading zeros
    for (const byte of bytes) {
      if (byte === 0) {
        result = '1' + result;
      } else {
        break;
      }
    }
    
    return result || '1';
  }
}

// Export singleton instance
export const solanaBridgeImplementation = new SolanaBridgeImplementation();
