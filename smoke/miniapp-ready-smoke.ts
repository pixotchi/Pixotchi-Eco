import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const providersSource = fs.readFileSync(
  path.join(process.cwd(), 'components/auth/host-wallet-boundary.tsx'),
  'utf8',
);

assert.match(
  providersSource,
  /import\('@farcaster\/miniapp-sdk'\)\.then\(\(\{ sdk \}\) => sdk\.actions\.ready\(\)\)/,
  'ready must load the SDK independently of the lazy wallet subtree',
);
assert.match(
  providersSource,
  /const MINI_APP_READY_TIMEOUT_MS = 2_500;/,
  'the ready attempt must have a bounded local deadline',
);

const hostProviderStart = providersSource.indexOf('<HostEnvironmentProvider>');
const readySignalMount = providersSource.indexOf('<MiniAppReadySignal />', hostProviderStart);
const providersContentMount = providersSource.indexOf('<HostAwareWalletGate', hostProviderStart);
assert.ok(hostProviderStart >= 0, 'HostEnvironmentProvider must remain mounted');
assert.match(fs.readFileSync(path.join(process.cwd(), 'app/providers.tsx'), 'utf8'), /<HostWalletBoundary[\s\S]*<ThemedPrivyProvider[\s\S]*<ProvidersContent/, 'host boundary must own provider and wallet initialization');
assert.ok(
  readySignalMount > hostProviderStart && readySignalMount < providersContentMount,
  'ready must mount inside the host environment and before the lazy Wagmi subtree',
);
assert.doesNotMatch(
  providersSource,
  /MiniAppReadySignal hostEnvironment=/,
  'ready must not be gated on a resolved Wagmi config',
);

assert.match(
  providersSource,
  /readyStateRef = useRef<'idle' \| 'pending' \| 'settled'>\('idle'\)/,
  'the signal must have a single-attempt state machine',
);
assert.match(
  providersSource,
  /readyStateRef\.current = 'pending';[\s\S]*?sdk\.actions\.ready\(\)[\s\S]*?Promise\.race\(\[readyAttempt, readinessDeadline\]\)[\s\S]*?readyStateRef\.current = 'settled';/,
  'pending must be marked before ready, with a bounded and settled attempt',
);

console.log('Mini App ready resilience smoke checks passed.');
