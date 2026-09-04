import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ChatAuthError,
  resolveConfiguredBaseAuthUrl,
  verifyBaseChatIdentity,
} from '../lib/chat-auth';

async function main() {

assert.equal(
  resolveConfiguredBaseAuthUrl('https://auth.pixotchi.example/some/path').origin,
  'https://auth.pixotchi.example',
);
assert.equal(resolveConfiguredBaseAuthUrl().origin, 'https://mini.pixotchi.tech');

for (const invalidUrl of [
  'not a URL',
  'javascript:alert(1)',
  'https://user:password@mini.pixotchi.tech',
]) {
  assert.throws(
    () => resolveConfiguredBaseAuthUrl(invalidUrl),
    (error) => error instanceof ChatAuthError && error.status === 500,
    `invalid fixed auth URL must fail closed: ${invalidUrl}`,
  );
}

const source = readFileSync(resolve(process.cwd(), 'lib/chat-auth.ts'), 'utf8');
const expectedUrlsFunction = source.match(
  /function getExpectedBaseUrls\(\): URL\[\] \{([\s\S]*?)\n\}/,
);
assert.ok(expectedUrlsFunction, 'expected Base URL resolver must exist');
assert.match(expectedUrlsFunction[1], /process\.env\.NEXT_PUBLIC_URL/);
const expectedUrlsExecutable = expectedUrlsFunction[1].replace(/\/\/.*$/gm, '');
assert.doesNotMatch(expectedUrlsExecutable, /request|headers|get\('host'\)|nextUrl|forwarded/i);
assert.match(source, /const expectedUrls = getExpectedBaseUrls\(\);/);
assert.doesNotMatch(source, /getExpectedBaseUrls\(request\)/);
assert.doesNotMatch(source, /getExpectedDomain\(request\)/);

process.env.NEXT_PUBLIC_URL = 'https://mini.pixotchi.tech';
const attackerAddress = '0x1111111111111111111111111111111111111111';
const attackerMessage = `evil.example wants you to sign in with your Ethereum account:
${attackerAddress}

Sign in

URI: https://evil.example
Version: 1
Chain ID: 8453
Nonce: abcdef12
Issued At: ${new Date().toISOString()}`;
const attackerHeaders = new Map([
  ['host', 'evil.example'],
  ['x-forwarded-host', 'evil.example'],
  ['x-forwarded-proto', 'https'],
]);
await assert.rejects(
  () => verifyBaseChatIdentity({
    headers: { get: (name: string) => attackerHeaders.get(name.toLowerCase()) ?? null },
    nextUrl: new URL('https://evil.example/api/chat/auth'),
  } as never, {
    address: attackerAddress,
    message: attackerMessage,
    signature: '0x00',
  }),
  (error) => error instanceof ChatAuthError && error.message === 'Unexpected SIWE domain.',
  'Host, X-Forwarded-Host, and request URL must not add attacker origins to the SIWE allowlist',
);
await assert.rejects(
  () => verifyBaseChatIdentity({
    headers: { get: (name: string) => attackerHeaders.get(name.toLowerCase()) ?? null },
    nextUrl: new URL('https://evil.example/api/chat/auth'),
  } as never, {
    address: attackerAddress,
    message: attackerMessage.replace(
      'evil.example wants you to sign in',
      'mini.pixotchi.tech wants you to sign in',
    ),
    signature: '0x00',
  }),
  (error) => error instanceof ChatAuthError && error.message === 'Unexpected SIWE origin.',
  'request-controlled forwarding headers must not authorize an attacker SIWE URI',
);

console.log('Chat auth fixed SIWE origin smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
