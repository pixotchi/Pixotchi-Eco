import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getBaseReadClient } from '../lib/base-rpc';
import { createBlackjackRedisStore } from '../lib/blackjack-lock-store';
import { withPrefix } from '../lib/redis';
import { CLIENT_ENV } from '../lib/env-config';
import {
  beginBlackjackReconciliation, newBlackjackScan, reconcileBlackjackAliases,
  scanBlackjackAliasPage, validateBlackjackScan,
} from '../lib/blackjack-alias-reconciliation';
import { blackjackAbi } from '../public/abi/blackjack-abi';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

async function main() {
  const apply = args.includes('--apply');
  const allSignersUpgraded = args.includes('--all-signers-upgraded');
  const rolloutId = option('--rollout-id');
  const checkpointFile = option('--checkpoint');
  const maxPages = Number(option('--max-pages') ?? '20');
  if (!rolloutId || !checkpointFile || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000) {
    throw new Error('Use --rollout-id ID --checkpoint PATH [--max-pages 20] [--apply --all-signers-upgraded]. Dry run is the default.');
  }
  if (apply && !allSignersUpgraded) throw new Error('Apply requires --all-signers-upgraded after every signing instance runs the canonical-lock release.');
  if (apply && process.env.BLACKJACK_CANONICAL_SIGNER_ROLLOUT_ID !== rolloutId) {
    throw new Error('The rollout ID must match BLACKJACK_CANONICAL_SIGNER_ROLLOUT_ID on every signing instance.');
  }
  const land = CLIENT_ENV.LAND_CONTRACT_ADDRESS;
  if (!land || !isAddress(land)) throw new Error('The configured Land contract address is invalid.');
  const client = getBaseReadClient();
  if (await client.getChainId() !== 8453) throw new Error('The configured RPC must use Base chain 8453.');
  const signer = await client.readContract({ address: land, abi: blackjackAbi, functionName: 'blackjackGetRandomnessSigner' });
  const configuredSigner = process.env.BLACKJACK_RANDOMNESS_SIGNER_KEY
    ? privateKeyToAccount(process.env.BLACKJACK_RANDOMNESS_SIGNER_KEY as `0x${string}`).address
    : option('--signer');
  if (!configuredSigner || !isAddress(configuredSigner) || configuredSigner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error('The configured signer (or --signer address) must match the onchain Blackjack signer.');
  }
  const scope = `8453:${land.toLowerCase()}:${withPrefix('')}`;
  const checkpointPath = path.resolve(checkpointFile);
  let checkpoint = newBlackjackScan(rolloutId, signer as Address);
  try {
    const saved: unknown = JSON.parse(await readFile(checkpointPath, 'utf8'));
    if (!saved || typeof saved !== 'object' || !('scope' in saved) || saved.scope !== scope || !('scan' in saved) || !validateBlackjackScan(saved.scan)) {
      throw new Error('Checkpoint does not match this deployment or is malformed.');
    }
    checkpoint = saved.scan;
    if (checkpoint.rolloutId !== rolloutId || checkpoint.signer.toLowerCase() !== signer.toLowerCase()) throw new Error('Checkpoint signer or rollout differs.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const persist = async () => {
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    await writeFile(`${checkpointPath}.tmp`, JSON.stringify({ scope, scan: checkpoint }, null, 2), { mode: 0o600 });
    await rename(`${checkpointPath}.tmp`, checkpointPath);
  };
  const store = createBlackjackRedisStore();
  if (apply) {
    await beginBlackjackReconciliation(store, checkpoint);
    await persist();
  }
  let pages = 0;
  try {
    while (!checkpoint.complete && pages++ < maxPages) {
      await scanBlackjackAliasPage(store, checkpoint);
      await persist();
    }
    const report = await reconcileBlackjackAliases(store, checkpoint, { apply, allSignersUpgraded });
    // Reports intentionally omit signed seeds, signatures, private keys, and raw Redis errors.
    const reportPath = `${checkpointPath}.report.json`;
    await writeFile(reportPath, JSON.stringify({ mode: apply ? 'apply' : 'dry-run', complete: checkpoint.complete, ...report }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', status: report.status, complete: checkpoint.complete,
      scannedKeys: report.scannedKeys, copied: report.copied, quarantined: report.quarantined, unknownRecords: report.unknownRecords, reportPath }));
    if (report.status === 'unknown') process.exitCode = 2;
  } catch {
    await persist();
    console.error('Blackjack alias inventory is unknown. Resume the checkpoint after fixing the service; no stable inventory was declared.');
    process.exitCode = 2;
  }
}

void main().catch(() => {
  // Avoid upstream errors that can include credentials. Usage/rollout details live in the runbook.
  console.error('Blackjack reconciliation could not start. Check arguments, checkpoint, signer, Base RPC and Redis configuration. No stable inventory was declared.');
  process.exitCode = 2;
});
