import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MockRequestOptions = {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
};

function mockRequest(options: MockRequestOptions = {}) {
  const url = options.url ?? 'https://mini.pixotchi.tech/api/chat/send';
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const cookies = new Map(Object.entries(options.cookies ?? {}));

  return {
    cookies: {
      get(name: string) {
        const value = cookies.get(name);
        return value == null ? undefined : { name, value };
      },
    },
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    nextUrl: new URL(url),
    url,
  };
}

async function main() {
  const {
    ChatAuthError,
    getChatSessionOrQuickAuthFromRequest,
  } = await import('../lib/chat-auth');

  async function assertNoSession(label: string, request: ReturnType<typeof mockRequest>) {
    const result = await getChatSessionOrQuickAuthFromRequest(request as never);
    assert.equal(result.session, null, label);
    assert.equal(result.viaQuickAuth, false, label);
  }

  const attackerAddress = '0x1111111111111111111111111111111111111111';

  await assertNoSession('forged Mini App headers must not authenticate', mockRequest({
    headers: {
      'x-pixotchi-address': attackerAddress,
      'x-pixotchi-miniapp': '1',
    },
  }));

  await assertNoSession('forged Mini App cookies must not authenticate', mockRequest({
    cookies: {
      pixotchi_miniapp: '1',
      pixotchi_miniapp_address: attackerAddress,
    },
  }));

  await assertNoSession('query address must not authenticate', mockRequest({
    url: `https://mini.pixotchi.tech/api/chat/send?address=${attackerAddress}`,
  }));

  await assertNoSession('forged connected wallet header must not authenticate without Quick Auth', mockRequest({
    headers: {
      'x-pixotchi-connected-wallet': attackerAddress,
    },
  }));

  await assert.rejects(
    () => getChatSessionOrQuickAuthFromRequest(mockRequest({
      headers: {
        authorization: 'Bearer not-a-jwt',
      },
    }) as never),
    (error) => error instanceof ChatAuthError && error.status === 401,
    'invalid Quick Auth Bearer token must fail as 401',
  );

  const authSource = readFileSync(resolve(process.cwd(), 'lib/chat-auth.ts'), 'utf8');
  assert(!authSource.includes('fidmap:'), 'chat auth must not read unauthenticated fidmap cache keys');
  assert(
    authSource.includes('chat:auth:farcaster:primary-address'),
    'chat auth must use a trusted Farcaster auth address cache namespace',
  );
  assert(
    authSource.includes('chat:auth:farcaster:verified-ethereum-addresses'),
    'chat auth must cache only Farcaster-verified Ethereum addresses for connected wallet binding',
  );
  assert(
    authSource.includes('Farcaster connected wallet address is required.'),
    'Farcaster Quick Auth sessions must require an explicit connected wallet address',
  );
  assert(!authSource.includes('x-pixotchi-address'), 'chat auth must not trust Mini App address headers');
  assert(!authSource.includes('x-pixotchi-miniapp'), 'chat auth must not trust Mini App marker headers');
  assert(!authSource.includes('pixotchi_miniapp'), 'chat auth must not trust Mini App cookies');
  assert(!authSource.includes('fallbackAddress'), 'chat auth must not accept body/query fallback addresses');
  assert(authSource.includes('verifyJwt'), 'chat auth must verify Quick Auth JWTs');

  const protectedSources = [
    'app/api/chat/messages/route.ts',
    'app/api/chat/send/route.ts',
    'app/api/chat/ai/messages/route.ts',
    'app/api/chat/ai/send/route.ts',
    'app/api/gamification/streak/route.ts',
    'app/api/gamification/missions/route.ts',
  ];

  for (const file of protectedSources) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    assert(
      source.includes('getChatSessionOrQuickAuthFromRequest'),
      `${file} must use the Quick Auth/cookie auth helper`,
    );
    assert(!source.includes('getChatSessionOrMiniAppBypassFromRequest'), `${file} must not use Mini App bypass auth`);
    assert(!source.includes('fallbackAddress'), `${file} must not pass body fallback addresses into auth`);
  }

  console.log('Mini App auth hardening smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
