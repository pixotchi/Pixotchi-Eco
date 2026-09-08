import { spawn } from 'node:child_process';

// Deterministic domain regressions and real-component browser harnesses. The
// viewport Playwright matrix remains `frontend:test`; real provider journeys
// are separate in `frontend:app` because they require the local test wallet/RPC.
const checks = [
  ['tsx', 'smoke/building-transaction-guards-smoke.ts'],
  ['tsx', 'smoke/batch-reconciliation-smoke.ts'],
  ['tsx', 'smoke/social-p1-reliability-smoke.ts'],
  ['tsx', 'smoke/baccarat-result-smoke.ts'],
  ['tsx', 'smoke/blackjack-paid-recovery-smoke.ts'],
  ['tsx', 'smoke/casino-arcade-p1-smoke.ts'],
  ['node', 'smoke/gameplay-p1-components-smoke.mjs'],
  ['node', 'scripts/test-casino-p1.mjs'],
  ['node', 'scripts/test-arcade-p1.mjs'],
];

for (const [runtime, file] of checks) {
  console.log(`\nChecking ${file}`);
  const args = runtime === 'tsx' ? ['node_modules/tsx/dist/cli.mjs', file] : [file];
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  if (status !== 0) process.exit(status);
}
console.log('\nHigh-priority domain regression checks passed.');
