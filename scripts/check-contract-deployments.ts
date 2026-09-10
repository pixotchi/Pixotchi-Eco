import { readFileSync } from 'node:fs';
import { keccak256, parseAbi, type AbiFunction, type Address, type Hex } from 'viem';
import { getBaseReadClient } from '../lib/base-rpc';
import { compareDeployment, describeFunction, resolveCloneImplementation, type DeploymentManifest, type DeploymentObservation } from '../lib/deployment-check';
import { validateLocalManifest } from './lib/deployment-inventory';

const manifest = JSON.parse(readFileSync('config/contract-deployments.json', 'utf8')) as DeploymentManifest;
const plantAbi = parseAbi(['function getAllExtensions() view returns (((string name,string metadataURI,address implementation) metadata,(bytes4 functionSelector,string functionSignature)[] functions)[] allExtensions)']);
const facetsAbi = parseAbi(['function facets() view returns ((address facetAddress,bytes4[] functionSelectors)[])']);
const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const beaconSlot = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const addressFromSlot = (value?: Hex) => value && BigInt(value) !== BigInt(0) ? `0x${value.slice(-40)}` as Address : null;

async function observeLive(): Promise<DeploymentObservation> {
  const url = process.env.RPC_NODE || process.env.BASE_RPC_NODE;
  if (!url) throw new Error('Set RPC_NODE or BASE_RPC_NODE for a live read-only check.');
  const client = getBaseReadClient();
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== manifest.chainId) return { chainId, blockNumber: blockNumber.toString(), contracts: {}, implementations: {} };
  const observation: DeploymentObservation = { chainId, blockNumber: blockNumber.toString(), contracts: {}, implementations: {} };
  const targets = new Set<string>();
  for (const contract of manifest.contracts) {
    const address = contract.address as Address;
    const routes: Record<string, string> = {};
    try {
      const code = await client.getCode({ address, blockNumber });
      if (!code || code === '0x') {
        observation.contracts[address] = { runtimeHash: keccak256('0x'), routes };
        continue;
      }
      let implementation: string | undefined;
      if (contract.kind === 'plant') {
        const extensions = await client.readContract({ address, abi: plantAbi, functionName: 'getAllExtensions', blockNumber }) as readonly {
          metadata: { implementation: Address };
          functions: readonly { functionSelector: Hex }[];
        }[];
        for (const extension of extensions) for (const fn of extension.functions) routes[fn.functionSelector] = extension.metadata.implementation.toLowerCase();
      } else if (contract.kind === 'diamond') {
        const facets = await client.readContract({ address, abi: facetsAbi, functionName: 'facets', blockNumber });
        for (const facet of facets) for (const selector of facet.functionSelectors) routes[selector] = facet.facetAddress.toLowerCase();
      } else if (contract.kind === 'proxy') {
        implementation = resolveCloneImplementation(code) ?? addressFromSlot(await client.getStorageAt({ address, slot: implementationSlot, blockNumber })) ?? undefined;
        if (!implementation) {
          const beacon = addressFromSlot(await client.getStorageAt({ address, slot: beaconSlot, blockNumber }));
          if (beacon) implementation = await client.readContract({ address: beacon, abi: parseAbi(['function implementation() view returns (address)']), functionName: 'implementation', blockNumber });
        }
        if (!implementation) throw new Error('Unknown proxy implementation');
      } else implementation = address;
      observation.contracts[address] = { runtimeHash: keccak256(code), routes, implementation: implementation?.toLowerCase() };
      for (const target of implementation ? [implementation] : Object.values(routes)) targets.add(target.toLowerCase());
    } catch {
      // Never print a Viem error: it can include a credential-bearing RPC URL.
      observation.contracts[address] = { runtimeHash: null, routes: null };
    }
  }
  // Keep explorer and RPC concurrency bounded. The source must match this block's runtime.
  const addresses = [...targets];
  for (let offset = 0; offset < addresses.length; offset += 4) {
    await Promise.all(addresses.slice(offset, offset + 4).map(async address => {
      let runtimeHash: string | null = null;
      let functions: ReturnType<typeof describeFunction>[] | null = null;
      try {
        const code = await client.getCode({ address: address as Address, blockNumber });
        runtimeHash = code && code !== '0x' ? keccak256(code) : null;
        const response = await fetch(`https://base.blockscout.com/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(15_000) });
        if (response.ok) {
          const source = await response.json();
          if (source.is_verified && Array.isArray(source.abi) && /^0x[0-9a-f]+$/i.test(source.deployed_bytecode) && keccak256(source.deployed_bytecode as Hex) === runtimeHash) {
            functions = (source.abi as AbiFunction[]).filter(fn => fn.type === 'function').map(describeFunction);
          }
        }
      } catch { /* Source unavailable is separate from a selector mismatch. */ }
      observation.implementations[address] = { runtimeHash, functions };
    }));
  }
  return observation;
}

async function main() {
  const localErrors = validateLocalManifest(manifest);
  const live = process.argv.includes('--live');
  const features = new Set(manifest.contracts.flatMap(c => c.functions.flatMap(fn => fn.features ?? []))
    .filter(flag => !live || process.env[flag] === 'true' || (flag === 'NEXT_PUBLIC_BARRACKS_ENABLED' && process.env[flag] !== 'false') || (flag === 'BATCH_ROUTER_CONFIGURED' && Boolean(process.env.NEXT_PUBLIC_BATCH_ROUTER_ADDRESS))));
  if (live) for (const contract of manifest.contracts) {
    const configured = contract.addressEnv && process.env[contract.addressEnv];
    if (configured && configured.toLowerCase() !== contract.address.toLowerCase()) localErrors.push(`${contract.id}: configured address requires deliberate manifest review`);
  }
  const observation = live ? await observeLive() : JSON.parse(readFileSync('tests/fixtures/deployments/base-2026-09-10.json', 'utf8')) as DeploymentObservation;
  const issues = compareDeployment(manifest, observation, features);
  console.log(JSON.stringify({ mode: live ? 'live-read-only' : 'fixture', chainId: observation.chainId, blockNumber: observation.blockNumber, localErrors, issues }, null, 2));
  if (localErrors.length || issues.some(issue => issue.severity === 'error')) process.exitCode = 1;
  // Fixture source gaps are explicit known limitations, not successful source checks.
  else if (live && issues.some(issue => issue.severity === 'unknown'
    && (issue.category !== 'source_unavailable' || !process.argv.includes('--allow-source-unavailable')))) process.exitCode = 2;
}

main().catch(() => { console.error('Deployment observation failed. No transactions were sent; check RPC access and try again.'); process.exitCode = 2; });
