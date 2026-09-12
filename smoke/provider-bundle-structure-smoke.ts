import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectFile = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  'utf8',
);

const providers = projectFile('app/providers.tsx');
const hostWalletBoundary = projectFile('components/auth/host-wallet-boundary.tsx');
const hostEnvironment = projectFile('lib/host-environment.tsx');
const solanaProvider = projectFile('components/solana/SolanaWalletProvider.tsx');
const privySolanaIdentity = projectFile('components/solana/PrivySolanaWalletIdentity.tsx');
const appShell = projectFile('app/(game)/page.tsx');
const chatProvider = projectFile('components/chat/chat-context.tsx');
const farcasterAuthClient = projectFile('lib/farcaster-miniapp-auth-client.ts');
const externalLinks = projectFile('lib/open-external.ts');
const farcasterNavigation = projectFile('hooks/useFarcaster.ts');

assert.doesNotMatch(
  providers,
  /^import .*@farcaster\/miniapp-sdk/m,
  'the always-mounted provider shell must not statically load Farcaster',
);
assert.match(
  hostWalletBoundary,
  /import\('@farcaster\/miniapp-sdk'\)\.then\(\(\{ sdk \}\) => sdk\.actions\.ready\(\)\)/,
  'the independent Mini App ready signal must remain dynamically loaded',
);
assert.doesNotMatch(
  hostEnvironment,
  /^import .*@farcaster\/miniapp-sdk/m,
  'the host probe must not pull the Farcaster SDK into first-load code',
);
assert.match(
  hostEnvironment,
  /miniAppSdkPromise \?\?= import\('@farcaster\/miniapp-sdk'\)/,
  'the host probe must memoize one lazy Farcaster SDK load',
);
for (const [name, source] of [
  ['app shell', appShell],
  ['chat provider', chatProvider],
  ['Mini App auth client', farcasterAuthClient],
  ['external-link helper', externalLinks],
  ['Farcaster navigation hook', farcasterNavigation],
] as const) {
  assert.doesNotMatch(
    source,
    /^import .*@farcaster\/miniapp-sdk/m,
    `${name} must not statically pull Farcaster into the first-load graph`,
  );
  assert.match(source, /import\('@farcaster\/miniapp-sdk'\)/);
}

assert.doesNotMatch(solanaProvider, /@privy-io\/react-auth/);
assert.doesNotMatch(solanaProvider, /@privy-io\/react-auth\/solana/);
assert.match(
  solanaProvider,
  /dynamic\([\s\S]*?import\('\.\/PrivySolanaWalletIdentity'\)[\s\S]*?ssr: false/,
  'Privy Solana hooks must be in a client-only lazy boundary',
);
assert.match(
  solanaProvider,
  /isPrivySolanaSurface \? \([\s\S]*?<PrivySolanaWalletIdentity/,
  'the heavy Solana identity bridge must mount only for the Privy Solana surface',
);
assert.match(privySolanaIdentity, /@privy-io\/react-auth\/solana/);

console.log('Provider bundle structure smoke checks passed.');
