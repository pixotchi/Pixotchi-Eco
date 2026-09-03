import { keccak256, type Hex } from 'viem';

type BroadcastSignedTransactionOptions = {
  broadcast: (serializedTransaction: Hex) => Promise<Hex>;
  isDefinitiveFailure: (error: unknown) => boolean;
  serializedTransaction: Hex;
};

/**
 * Broadcast a locally signed transaction without losing its durable identity.
 *
 * A signed EVM transaction's hash is known before it is sent. If an RPC accepts
 * the bytes but its response is lost, treating the request as proofless strands
 * the whole app behind an ambiguous reservation even though the transaction may
 * already be mined. Return the locally derived hash for ambiguous broadcast
 * failures so the canonical receipt monitor can resolve the real outcome.
 *
 * Errors that prove the request was never forwarded are still rethrown, which
 * lets the transaction lifecycle safely remove the unsubmitted reservation.
 */
export async function broadcastSignedLocalTestTransaction({
  broadcast,
  isDefinitiveFailure,
  serializedTransaction,
}: BroadcastSignedTransactionOptions): Promise<Hex> {
  const transactionHash = keccak256(serializedTransaction);

  try {
    await broadcast(serializedTransaction);
  } catch (error) {
    if (isDefinitiveFailure(error)) throw error;
  }

  return transactionHash;
}
