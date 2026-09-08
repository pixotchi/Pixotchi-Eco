import { spawn } from 'node:child_process';

// Additional medium-round component checks. Existing casino/arcade runners
// already cover both rounds and remain in frontend:p1; *.spec.ts uses the
// common frontend:test browser matrix.
const checks = [
  ['tsx', 'smoke/blackjack-baccarat-medium-smoke.ts'],
  ['node', 'smoke/quest-funding-read-smoke.mjs'],
  ['node', 'smoke/upgrade-affordability-smoke.mjs'],
  ['node', 'smoke/building-p2-components-smoke.mjs'],
  ['node', 'smoke/gameplay-medium-components-smoke.mjs'],
  ['node', 'smoke/land-map-medium-smoke.mjs'],
  ['node', 'smoke/tasks-tutorial-medium-smoke.mjs'],
  ['tsx', 'smoke/mission-actions-smoke.ts'],
  ['tsx', 'smoke/mint-copy-read-smoke.ts'],
  ['node', 'smoke/mission-assets-hook-smoke.mjs'],
  ['node', 'smoke/gameplay-medium-components-smoke.mjs', '--missions-only'],
  ['node', 'smoke/mission-plant-navigation-smoke.mjs'],
];
for (const [runtime, file, ...options] of checks) {
  console.log(`\nChecking ${file}`);
  const args = runtime === 'tsx' ? ['node_modules/tsx/dist/cli.mjs', file, ...options] : [file, ...options];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve(signal ? 1 : status ?? 1));
  });
  if (code !== 0) process.exit(code);
}
console.log('\nMedium-priority component regression checks passed.');
