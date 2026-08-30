import assert from 'node:assert/strict';
import { clearAppCaches } from '../lib/cache-utils';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function main() {
  const local = new MemoryStorage();
  const session = new MemoryStorage();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: local,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: session,
  });

  const durableKeys = [
    'pixotchi:pending-evm:v2:8453:0xabc:intent',
    'pixotchi:transfer-assets:v1:8453:0xabc',
    'pixotchi:efp-workflow:v1:8453:0xabc',
    'pixotchi:solana-bridge:pending:v2:base-to-solana:0xabc',
    'pixotchi:spinleaf:pending:0xabc',
  ];

  for (const key of durableKeys) {
    local.setItem(key, 'proof');
    session.setItem(key, 'proof');
  }
  local.setItem('pixotchi:ambient-audio', 'enabled');
  session.setItem('pixotchi:temporary-ui', 'open');
  local.setItem('third-party-state', 'keep');

  await clearAppCaches({ onlyPrefixes: ['pixotchi'] });

  for (const key of durableKeys) {
    assert.equal(local.getItem(key), 'proof', `local durable record was erased: ${key}`);
    assert.equal(session.getItem(key), 'proof', `session durable record was erased: ${key}`);
  }
  assert.equal(local.getItem('pixotchi:ambient-audio'), null);
  assert.equal(session.getItem('pixotchi:temporary-ui'), null);
  assert.equal(local.getItem('third-party-state'), 'keep');

  console.log('cache-utils smoke passed');
}

void main();
