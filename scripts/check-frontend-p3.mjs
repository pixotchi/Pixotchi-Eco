import { spawn } from 'node:child_process';

// Focused component/contract checks supplement the shared Playwright matrix.
const checks = [
  ['tsx', 'smoke/blackjack-mission-smoke.ts'],
  ['node', 'smoke/building-p3-components-smoke.mjs'],
  ['node', 'smoke/building-p3-components-smoke.mjs', '--webkit-picker'],
  ['node', 'smoke/building-p2-components-smoke.mjs', '--preview'],
  ['node', 'smoke/maps-time-low-smoke.mjs'],
];
for (const [runtime, file, ...extra] of checks) {
  console.log(`Checking ${[file, ...extra].join(' ')}`);
  const args = runtime === 'tsx' ? ['node_modules/tsx/dist/cli.mjs', file, ...extra] : [file, ...extra];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve(signal ? 1 : status ?? 1));
  });
  if (code !== 0) process.exit(code);
}
console.log('Low-priority component regression checks passed.');
