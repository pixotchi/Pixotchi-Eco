import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [entry, ...args] = process.argv.slice(2);

if (!entry) {
  console.error('Usage: node scripts/run-react-server-smoke.mjs <entry.ts> [...args]');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--conditions=react-server', '--import', 'tsx', entry, ...args],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_PATH: resolve('node_modules/next/dist/compiled'),
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
