import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const smokeDir = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(path.join(smokeDir, '..', 'lib', 'ens-resolver.ts'), 'utf8');
  const batchResolver = source.slice(source.indexOf('export async function resolvePrimaryNames'));

  assert.match(source, /const values = await redis\.mget\(\.\.\.keys\);/);
  assert.match(source, /value: name === '' \? null : name/);
  assert.match(source, /const NAME_LOOKUP_CONCURRENCY = 8;/);
  assert.match(batchResolver, /Math\.min\(NAME_LOOKUP_CONCURRENCY, addressesToFetch\.length\)/);
  assert.doesNotMatch(batchResolver, /await readCache\(/);

  console.log('identity resolver batch smoke passed');
}

void main();
