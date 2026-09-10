import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BLACKJACK_UINT256_MAX } from '../lib/blackjack-locks';

const player = `0x${'3'.repeat(40)}`;
const token = `0x${'2'.repeat(40)}`;
const state = {
  casinoEnabled: true, blackjackEnabled: true, playable: true, acknowledged: true,
  nonce: BigInt(7), safeNonce: BigInt(7), canHit: true, phase: 2,
  reads: [] as Array<{ functionName: string; args: unknown[]; blockTag?: string }>,
  client: {} as { readContract: (args: { functionName: string; args: unknown[]; blockTag?: string }) => Promise<unknown> },
};
state.client.readContract = async args => {
  state.reads.push(args);
  switch (args.functionName) {
    case 'blackjackGetNonce': return args.blockTag === 'safe' ? state.safeNonce : state.nonce;
    case 'blackjackGetGameToken': return token;
    case 'blackjackGetGameBasic': return [true, player, state.phase, BigInt(100), 1, false, 0, false, BigInt(0), 0];
    case 'blackjackGetActions': return [state.canHit, true, true, true, true, false];
    case 'ownerOf': return player;
    case 'getApproved': return `0x${'0'.repeat(40)}`;
    case 'blackjackGetTokenConfig': return [true, BigInt(1), BigInt(10000), player, true, 0];
    default: throw new Error(`Unexpected contract read: ${args.functionName}`);
  }
};

async function main() {
  const mocks: Record<string, string> = {
    '@/lib/base-rpc': `export const getBaseReadClient=()=>globalThis.blackjackRouteFixture.client;`,
    '@/lib/casino-feature': `export const getCasinoPolicy=()=>globalThis.blackjackRouteFixture; export const isLegacyBlackjackContractAcknowledged=()=>globalThis.blackjackRouteFixture.acknowledged;`,
    '@/lib/casino-policy': `export const BLACKJACK_DISABLED_MESSAGE='Blackjack disabled';`,
    '@/lib/chat-auth': `export class ChatAuthError extends Error{}; export const createChatAuthErrorResponse=()=>Response.json({}, {status:403}); export const createChatAuthRequiredResponse=createChatAuthErrorResponse; export const getChatSessionOrQuickAuthFromRequest=async()=>({session:{address:'${player}'},sessionId:'fixture'});`,
    '@/lib/contracts': `export const LAND_CONTRACT_ADDRESS='0x4444444444444444444444444444444444444444';`,
    '@/lib/redis': `export const redis=null; export const redisDel=async()=>true;export const withPrefix=key=>key;`,
    './redis': `export const redis=null; export const redisDel=async()=>true;export const withPrefix=key=>key;`,
    'next/server': `export class NextResponse extends Response{ static json(body,init){return Response.json(body,init)} } export class NextRequest extends Request{}`,
  };
  const result = await build({
    entryPoints: [path.resolve('app/api/blackjack/random/route.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', define: {
      'process.env.NODE_ENV': '"test"',
      'process.env.BLACKJACK_RANDOMNESS_SIGNER_KEY': JSON.stringify(`0x${'1'.repeat(64)}`),
    },
    plugins: [{ name: 'blackjack-route-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'pixotchi-blackjack-route-'));
  const file = path.join(directory, 'route.cjs');
  try {
    await writeFile(file, result.outputFiles[0].contents);
    Object.assign(globalThis, { blackjackRouteFixture: state });
    const { POST } = createRequire(import.meta.url)(file) as { POST: (request: Request) => Promise<Response> };
    const request = (landId: string, action = 'hit') => POST(new Request('http://localhost/api/blackjack/random', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ landId, action, handIndex: 0, playerAddress: player, bettingToken: token, betAmountWei: '100' }),
    }));
    for (const landId of ['01', '00', '-1', '1'.repeat(79), (BLACKJACK_UINT256_MAX + BigInt(1)).toString()]) {
      assert.equal((await request(landId)).status, 400);
    }
    assert.equal(state.reads.length, 0, 'Noncanonical IDs fail before RPC or signing');
    for (const gate of ['casinoEnabled', 'blackjackEnabled', 'playable', 'acknowledged'] as const) {
      state[gate] = false;
      assert.equal((await request('1')).status, 503, `${gate} remains authoritative`);
      state[gate] = true;
    }
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => request('1')));
    assert.ok(concurrent.every(response => response.status === 200));
    const bodies = await Promise.all(concurrent.map(response => response.json()));
    assert.equal(new Set(bodies.map(body => body.randomSeed)).size, 1, 'Concurrent requests return one decision');
    assert.equal(new Set(bodies.map(body => body.signature)).size, 1);
    assert.equal(bodies[0].nonce, '7', 'Nonce retains exact numeric identity');
    state.canHit = false;
    assert.equal((await request('1', 'stand')).status, 400, 'Unavailable signed hit remains locked; stand cannot replace it');
    state.canHit = true;
    const retry = await (await request('1')).json();
    assert.equal(retry.signature, bodies[0].signature);
    assert.equal(retry.randomSeed, bodies[0].randomSeed);
    state.nonce = BigInt(8);
    const next = await (await request('1')).json();
    assert.equal(next.nonce, '8');
    assert.notEqual(next.signature, retry.signature);
    // A head-only advancement cannot remove the old nonce's still-valid signature.
    state.nonce = BigInt(7);
    const revertedHead = await (await request('1')).json();
    assert.equal(revertedHead.signature, retry.signature);
    // Once safe advancement is confirmed, obsolete nonce material may be removed.
    state.nonce = BigInt(9); state.safeNonce = BigInt(8);
    assert.equal((await request('1')).status, 200);
    assert.ok(state.reads.filter(read => read.functionName === 'blackjackGetNonce' && read.blockTag === 'safe').length > 0);
    assert.ok(state.reads.every(read => typeof read.args[0] === 'bigint' || read.functionName === 'blackjackGetTokenConfig'));
    console.log('Blackjack route regressions passed: canonical IDs, preserved gates, same-nonce concurrency, temporary unavailable actions and safe nonce cleanup.');
  } finally {
    delete (globalThis as Record<string, unknown>).blackjackRouteFixture;
    await unlink(file).catch(() => undefined);
    await rmdir(directory);
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
