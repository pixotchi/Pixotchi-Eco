import { toFunctionSelector, type AbiFunction, type AbiParameter } from 'viem';

export type DeploymentFunction = {
  signature: string;
  selector: string;
  outputs: string[];
  implementation: string;
  runtimeHash: string;
  /** All these feature flags must be enabled; omitted means always required. */
  features?: string[];
};
export type DeploymentContract = {
  id: string;
  address: string;
  addressEnv?: string;
  kind: 'plant' | 'diamond' | 'proxy' | 'direct';
  runtimeHash: string;
  sources: { file: string; exportName?: string; features?: string[] }[];
  functions: DeploymentFunction[];
};
export type DeploymentManifest = {
  v: 1;
  chainId: number;
  reviewedAtBlock: string;
  contracts: DeploymentContract[];
};
export type ObservedImplementation = {
  runtimeHash: string | null;
  /** Null means source unavailable or not matched to the observed runtime. */
  functions: { signature: string; selector: string; outputs: string[] }[] | null;
};
export type DeploymentObservation = {
  chainId: number;
  blockNumber: string;
  contracts: Record<string, {
    runtimeHash: string | null;
    /** Null is an observation failure, whereas an empty table is an empty deployment. */
    routes: Record<string, string> | null;
    implementation?: string;
  }>;
  implementations: Record<string, ObservedImplementation>;
};
export type DeploymentIssue = {
  contract: string;
  selector?: string;
  category: 'chain_mismatch' | 'observation_unavailable' | 'deployment_changed' | 'selector_missing' | 'output_mismatch' | 'source_unavailable';
  severity: 'error' | 'unknown';
};

export function abiType(parameter: AbiParameter): string {
  return parameter.type.startsWith('tuple')
    ? `(${('components' in parameter ? parameter.components : []).map(abiType).join(',')})${parameter.type.slice(5)}`
    : parameter.type;
}

export function describeFunction(fn: AbiFunction) {
  const signature = `${fn.name}(${fn.inputs.map(abiType).join(',')})`;
  return { signature, selector: toFunctionSelector(signature), outputs: fn.outputs.map(abiType) };
}

export function compareDeployment(
  manifest: DeploymentManifest,
  observation: DeploymentObservation,
  features: ReadonlySet<string> = new Set(),
): DeploymentIssue[] {
  const issues: DeploymentIssue[] = [];
  if (manifest.chainId !== observation.chainId) {
    return [{ contract: '*', category: 'chain_mismatch', severity: 'error' }];
  }
  for (const contract of manifest.contracts) {
    const required = contract.functions.filter(fn => !fn.features || fn.features.every(flag => features.has(flag)));
    if (!required.length) continue;
    const actual = observation.contracts[contract.address.toLowerCase()];
    if (!actual || actual.runtimeHash === null || actual.routes === null) {
      issues.push({ contract: contract.id, category: 'observation_unavailable', severity: 'unknown' });
      continue;
    }
    if (actual.runtimeHash !== contract.runtimeHash) {
      issues.push({ contract: contract.id, category: 'deployment_changed', severity: 'error' });
    }
    for (const fn of required) {
      const issue = (category: DeploymentIssue['category'], severity: DeploymentIssue['severity'] = 'error') =>
        issues.push({ contract: contract.id, selector: fn.selector, category, severity });
      const implementation = contract.kind === 'direct' || contract.kind === 'proxy'
        ? actual.implementation ?? contract.address
        : actual.routes[fn.selector];
      if (!implementation) { issue('selector_missing'); continue; }
      if (implementation.toLowerCase() !== fn.implementation.toLowerCase()) issue('deployment_changed');
      const source = observation.implementations[implementation.toLowerCase()];
      if (!source || source.runtimeHash === null) { issue('observation_unavailable', 'unknown'); continue; }
      if (source.runtimeHash !== fn.runtimeHash) issue('deployment_changed');
      if (!source.functions) { issue('source_unavailable', 'unknown'); continue; }
      const definition = source.functions.find(item => item.selector === fn.selector);
      if (!definition || definition.signature !== fn.signature) issue('selector_missing');
      else if (JSON.stringify(definition.outputs) !== JSON.stringify(fn.outputs)) issue('output_mismatch');
    }
  }
  return issues;
}

/** Standard EIP-1167 clones; EIP-1967 is resolved separately from storage. */
export function resolveCloneImplementation(code: string): string | null {
  const match = /^0x363d3d373d3d3d363d73([a-fA-F0-9]{40})5af43d82803e903d91602b57fd5bf3/.exec(code);
  return match ? `0x${match[1].toLowerCase()}` : null;
}
