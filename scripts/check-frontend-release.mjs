import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function fixtureRoutes(directory = path.resolve('app/qa')) {
  const routes = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...await fixtureRoutes(location));
    else if (entry.name === 'page.tsx') routes.push('/' + path.relative(path.resolve('app'), directory).replaceAll('\\', '/'));
  }
  return routes;
}

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
  const routes = await fixtureRoutes();
  for (const route of routes.filter(route => route !== '/qa/frontend')) {
    const fixture = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(fixture.status, 404, `${route} must never be published`);
    assert.doesNotMatch(await fixture.text(), /data-(?:fixtures|focus|ai)-ready|Regression fixtures/);
  }
  const root = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-security-policy') ?? '', /upgrade-insecure-requests/);
  console.log(`Release isolation passed: all ${routes.length} QA routes are 404 and production CSP is intact.`);
} finally {
  server.kill();
}
