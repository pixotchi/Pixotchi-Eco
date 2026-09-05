import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 3002;
const origin = `http://localhost:${port}`;
// Own this process so cleanup never touches the developer's running dev server.
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let exited = false;
server.on('exit', () => { exited = true; });
server.on('error', error => { output += error.message; exited = true; });
server.stdout.on('data', data => { output = (output + data).slice(-8000); });
server.stderr.on('data', data => { output = (output + data).slice(-8000); });
try {
  const deadline = Date.now() + 50_000;
  let response;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Release server exited: ${output}`);
    if (!output.includes('Ready in')) { await delay(200); continue; }
    try { response = await fetch(`${origin}/qa/frontend`, { signal: AbortSignal.timeout(2000) }); break; }
    catch { await delay(200); }
  }
  assert.ok(response, `Release server did not start: ${output}`);
  assert.equal(response.status, 404, 'Development fixtures must never be published');
  assert.doesNotMatch(await response.text(), /data-fixtures-ready|Swap controller fixture/);
  const root = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-security-policy') ?? '', /upgrade-insecure-requests/);
  console.log('Release isolation passed: QA route is 404 and production CSP is intact.');
} finally {
  server.kill();
}
