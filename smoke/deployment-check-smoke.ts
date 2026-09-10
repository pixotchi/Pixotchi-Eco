import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareDeployment, resolveCloneImplementation, type DeploymentManifest, type DeploymentObservation } from '../lib/deployment-check';
import { readLocalAbi, validateLocalManifest } from '../scripts/lib/deployment-inventory';
const manifest = JSON.parse(readFileSync('config/contract-deployments.json', 'utf8')) as DeploymentManifest;
const fixture = JSON.parse(readFileSync('tests/fixtures/deployments/base-2026-09-10.json', 'utf8')) as DeploymentObservation;
const flags = new Set(manifest.contracts.flatMap(c => c.functions.flatMap(fn => fn.features ?? [])));
const plant = manifest.contracts.find(c => c.id === 'plant')!;
const required = plant.functions.find(fn => fn.signature === 'canKill(address)')!;
assert.deepEqual(validateLocalManifest(manifest), []);
assert.equal(compareDeployment(manifest, fixture, flags).filter(issue => issue.severity === 'error').length, 0);
// Pin the app's independently declared writes and readiness reads. A checker
// cannot notice a missing route when that selector was omitted from its input.
const requiredAppCalls = {
  plant: [
    'attack(uint256,uint256)', 'kill(uint256,uint256)', 'Revive(uint256)',
    'transferFrom(address,address,uint256)', 'setApprovalForAll(address,bool)',
    'isApprovedForAll(address,address)', 'totalSupply()', 'ownerOf(uint256)',
  ],
  land: ['questGetDifficultyConfig(uint8)', 'questGetAllRewardRanges()'],
  seed: ['transfer(address,uint256)'],
  'creator-token': ['transfer(address,uint256)'],
  baseswap: ['getAmountsIn(uint256,address[])'],
};
for (const [id, signatures] of Object.entries(requiredAppCalls)) {
  const contract = manifest.contracts.find(item => item.id === id)!;
  for (const signature of signatures) {
    const fn = contract.functions.find(item => item.signature === signature);
    assert.ok(fn, `${id}:${signature} must be inventoried`);
    assert.ok(!fn.features?.length, `${id}:${signature} must be required without optional features`);
    const changed = structuredClone(fixture);
    if (contract.kind === 'plant' || contract.kind === 'diamond') {
      delete changed.contracts[contract.address].routes![fn.selector];
    } else {
      const observed = changed.implementations[fn.implementation];
      assert.ok(observed.functions, `${id}:${signature} has verified implementation source`);
      observed.functions = observed.functions.filter(item => item.selector !== fn.selector);
    }
    assert.ok(compareDeployment(manifest, changed).some(issue =>
      issue.contract === id && issue.selector === fn.selector && issue.category === 'selector_missing'),
    `${id}:${signature} removal must be detected`);
  }
}
assert.equal(readLocalAbi('viem:erc20Abi').length, 9);
assert.deepEqual(readLocalAbi('viem:erc721Abi', 'isApprovedForAll').map(fn => fn.name), ['isApprovedForAll']);
assert.throws(() => readLocalAbi('viem:erc721Abi', 'missingFunction'), /Missing reviewed ABI/);
{
  const changed = structuredClone(manifest);
  const plant = changed.contracts.find(contract => contract.id === 'plant')!;
  plant.functions = plant.functions.filter(fn => fn.signature !== 'kill(uint256,uint256)');
  assert.ok(validateLocalManifest(changed).some(error => error.includes('kill(uint256,uint256)')));
}
{
  const creator = manifest.contracts.find(contract => contract.id === 'creator-token')!;
  const required = creator.functions.find(fn => fn.signature === 'transfer(address,uint256)')!;
  assert.equal(creator.kind, 'proxy');
  assert.equal(required.implementation, '0x36853f9f48faee51bd3db15db21eb4b9038bb795');
  const changed = structuredClone(fixture);
  changed.contracts[creator.address].implementation = '0x0000000000000000000000000000000000000001';
  assert.ok(compareDeployment(manifest, changed).some(issue =>
    issue.contract === creator.id && issue.selector === required.selector && issue.category === 'deployment_changed'));
}
{
  const changed = structuredClone(fixture);
  changed.contracts[plant.address].runtimeHash = `0x${'1'.repeat(64)}`;
  assert.ok(compareDeployment(manifest, changed, flags).some(issue =>
    issue.contract === plant.id && issue.selector === undefined && issue.category === 'deployment_changed'));
}
{
  const changed = structuredClone(fixture);
  delete changed.contracts[plant.address].routes![required.selector];
  assert.ok(compareDeployment(manifest, changed, flags).some(issue => issue.selector === required.selector && issue.category === 'selector_missing'));
}
{
  const changed = structuredClone(fixture);
  changed.contracts[plant.address].routes![required.selector] = '0x0000000000000000000000000000000000000001';
  assert.ok(compareDeployment(manifest, changed, flags).some(issue => issue.selector === required.selector && issue.category === 'deployment_changed'));
}
{
  const changed = structuredClone(fixture);
  changed.implementations[required.implementation].functions = null;
  const issues = compareDeployment(manifest, changed, flags).filter(issue => issue.selector === required.selector);
  assert.deepEqual(issues.map(issue => issue.category), ['source_unavailable']);
}
{
  const changed = structuredClone(fixture);
  changed.implementations[required.implementation].functions!.find(fn => fn.selector === required.selector)!.outputs = ['uint256'];
  assert.ok(compareDeployment(manifest, changed, flags).some(issue => issue.selector === required.selector && issue.category === 'output_mismatch'));
}
{
  const changed = structuredClone(fixture);
  const land = manifest.contracts.find(c => c.id === 'land')!;
  const optional = land.functions.find(fn => fn.features?.includes('NEXT_PUBLIC_BLACKJACK_ENABLED'))!;
  delete changed.contracts[land.address].routes![optional.selector];
  assert.ok(compareDeployment(manifest, changed, flags).some(issue => issue.selector === optional.selector && issue.category === 'selector_missing'));
  assert.ok(!compareDeployment(manifest, changed).some(issue => issue.selector === optional.selector));
}
assert.equal(compareDeployment(manifest, { ...fixture, chainId: 1 }, flags)[0].category, 'chain_mismatch');
assert.equal(resolveCloneImplementation(`0x363d3d373d3d3d363d73${'1'.repeat(40)}5af43d82803e903d91602b57fd5bf3`), `0x${'1'.repeat(40)}`);
assert.equal(resolveCloneImplementation('0x6000'), null);
console.log('Deployment selector, implementation, source, output and feature regressions passed.');
