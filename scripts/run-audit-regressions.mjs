import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const container = `pixotchi-audit-${randomUUID()}`;
let ownsContainer = false;
try {
  let port = process.env.AUDIT_TEST_REDIS_PORT;
  if (!port) {
    await exec('docker', ['run', '--rm', '--detach', '--name', container, '--publish', '127.0.0.1::6379', 'redis:8-alpine'], { timeout: 60_000, windowsHide: true });
    ownsContainer = true;
    port = (await exec('docker', ['port', container, '6379/tcp'], { windowsHide: true })).stdout.trim().split(':').at(-1);
  }
  const env = { ...process.env, AUDIT_TEST_REDIS_PORT: port, NODE_ENV: 'test', NODE_PATH: resolve('node_modules/next/dist/compiled') };
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'smoke/audit-persistence-regressions-smoke.ts'], { env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); done(code ?? 1); });
  });
} finally {
  if (ownsContainer) await exec('docker', ['stop', container], { timeout: 30_000, windowsHide: true });
}
