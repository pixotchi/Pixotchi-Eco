import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

type FeedEvent = { __typename: string; id: string; nftId?: string; nftName?: string; timeExtension?: string };
type ActivityService = {
  getAllActivity(): Promise<FeedEvent[]>;
  getMyActivityFeed(address: string): Promise<{ activities: FeedEvent[]; plantIds: string[] }>;
};

test('public and personal activity query projections retain plant IDs and distinct same-name game records', async () => {
  const indexer = `
    export async function fetchIndexerGraphQL(query) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const data = {
        playeds: [
          { __typename: 'Played', id: 'game-11', nftId: '11', nftName: 'Same plant name', gameName: 'BoxGame', points: '1000000000000', timeExtension: '0', timestamp },
          { __typename: 'Played', id: 'game-11-rich', nftId: '11', nftName: 'Same plant name', gameName: 'BoxGame', points: '1000000000000', timeExtension: '3600', timestamp },
          { __typename: 'Played', id: 'game-12', nftId: '12', nftName: 'Same plant name', gameName: 'BoxGame', points: '1000000000000', timeExtension: '0', timestamp },
        ],
        itemConsumeds: [{ __typename: 'ItemConsumed', id: 'care-13', nftId: '13', nftName: 'Plant #13', giver: 'fixture', itemId: '1', timestamp }],
        shopItemPurchaseds: [{ __typename: 'ShopItemPurchased', id: 'shop-14', nftId: '14', nftName: 'Plant #14', giver: 'fixture', itemId: '1', timestamp }],
      };
      const response = {};
      // Emulate the indexer's selected-field projection, not an always-complete DTO.
      for (const [collection, rows] of Object.entries(data)) {
        const selection = query.match(new RegExp(collection + '\\\\([\\\\s\\\\S]*?items\\\\s*{([^}]*)}'))?.[1];
        if (!selection) continue;
        const fields = new Set(selection.trim().split(/\\s+/));
        response[collection] = { items: rows.map(row => Object.fromEntries(Object.entries(row).filter(([field]) => fields.has(field)))) };
      }
      return response;
    }`;
  const bundle = await build({ entryPoints: [path.resolve('lib/activity-service.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'activity-service-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/cache)$/ }, args => ({ path: args.path, namespace: 'identity-io' }));
    builder.onResolve({ filter: /(^|\/)(contracts|indexer-client)$/ }, args => ({ path: args.path.endsWith('contracts') ? 'contracts' : 'indexer', namespace: 'identity-io' }));
    builder.onLoad({ filter: /.*/, namespace: 'identity-io' }, args => ({ contents: args.path === 'server-only' ? '' : args.path === 'next/cache' ? 'export const unstable_cache = fn => fn;' : args.path === 'contracts' ? 'export const getPlantsByOwner = async () => [{id:11},{id:12},{id:13},{id:14}]; export const getLandsByOwner = async () => [];' : indexer, loader: 'js' }));
  } }] });
  const serviceModule = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, { module: serviceModule, exports: serviceModule.exports, console });
  const service = serviceModule.exports as ActivityService;
  const recent = await service.getAllActivity();
  const personal = await service.getMyActivityFeed('0x1111111111111111111111111111111111111111');
  for (const events of [recent, personal.activities]) {
    expect(events).toHaveLength(4);
    expect(events.map(event => event.nftId).sort()).toEqual(['11', '12', '13', '14']);
    expect(events.filter(event => event.__typename === 'Played')).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'game-11-rich', nftId: '11', timeExtension: '3600' })]));
    expect(events.some(event => event.id === 'game-11')).toBe(false);
  }
  expect(personal.plantIds).toEqual(['11', '12', '13', '14']);
});

test('real Activity renderers preserve known IDs and never invent absent plant or land identity', async ({ page }) => {
  const io = path.resolve('tests/frontend/fixtures/social-low-io.tsx');
  const bundle = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/activity-identity.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'activity-render-io', setup(builder) {
    builder.onResolve({ filter: /^(next\/image|@\/hooks\/useTokenMetadata)$/ }, () => ({ path: io }));
  } }] });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const common = { timestamp, nftName: '', points: '1000000000000', timeExtension: '0' };
  const activities = [
    { ...common, __typename: 'Played', id: 'played-known', nftId: '0', nftName: 'Named zero', gameName: 'BoxGame' },
    { ...common, __typename: 'Played', id: 'played-legacy', nftName: 'Plant #99999', gameName: 'BoxGame' },
    { ...common, __typename: 'ItemConsumed', id: 'care-legacy', nftId: null, nftName: 'A known plant name', itemId: '1', giver: 'fixture' },
    { ...common, __typename: 'ShopItemPurchased', id: 'shop-legacy', nftId: ' ', itemId: '1', giver: 'fixture' },
    { ...common, __typename: 'Mint', id: 'mint-missing' },
    { ...common, __typename: 'Mint', id: 'mint-unsafe', nftId: Number.MAX_SAFE_INTEGER + 1 },
    { ...common, __typename: 'Mint', id: 'mint-large', nftId: '18446744073709551617' },
    { ...common, __typename: 'Killed', id: 'kill-missing', nftId: 'undefined', deadId: null, winnerName: '', loserName: '', reward: '1' },
    { ...common, __typename: 'Attack', id: 'attack-missing', attacker: null, winner: null, loser: undefined, attackerName: '', winnerName: '', loserName: '', scoresWon: '1000000000000' },
    { ...common, __typename: 'Attack', id: 'attack-won', attacker: '0', winner: '0', loser: '41', attackerName: 'Winner', winnerName: 'Winner', loserName: 'Opponent', scoresWon: '1000000000000' },
    { ...common, __typename: 'Attack', id: 'attack-lost', attacker: '42', winner: '41', loser: '42', attackerName: 'Attacker', winnerName: 'Defender', loserName: 'Attacker', scoresWon: '1000000000000' },
    { __typename: 'WarehouseAssignmentEvent', id: 'warehouse-missing', timestamp, landId: null, plantId: undefined, resource: 'points', amount: '1000000000000' },
    { __typename: 'WarehouseAssignmentEvent', id: 'warehouse-known', timestamp, landId: '7', plantId: '42', resource: 'points', amount: '1000000000000' },
    { __typename: 'LandMintedEvent', id: 'land-token-missing', timestamp, tokenId: null },
    { __typename: 'BarracksRaidEvent', id: 'raid-missing', timestamp, attackerLandId: {}, defenderLandId: 'NaN', attackerWon: false },
  ];
  await page.route('https://activity-identity.test/**', route => route.request().url().includes('/api/activity/recent')
    ? route.fulfill({ json: { activities } })
    : route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' }));
  await page.goto('https://activity-identity.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.locator('[data-identity-ready=true]')).toBeVisible();
  const records = page.locator('[data-activity-record]');
  await expect(records).toHaveCount(15);
  await expect(page.locator('main')).not.toContainText(/#(?:undefined|null|NaN)|#\s*·/);
  await expect(page.getByRole('region', { name: 'played-known', exact: true }).locator('summary')).toContainText('Plant #0 (You)');
  const namedWithoutId = page.getByRole('region', { name: 'played-legacy', exact: true });
  await expect(namedWithoutId.locator('summary')).toContainText('Plant #99999');
  await expect(namedWithoutId).not.toContainText('(You)');
  await expect(page.getByRole('region', { name: 'warehouse-known', exact: true }).locator('summary')).toContainText('Land #7 (You)');
  await expect(page.getByRole('region', { name: 'warehouse-known', exact: true }).locator('summary')).toContainText('Plant #42');
  await expect(page.getByRole('region', { name: 'mint-large', exact: true }).locator('summary')).toContainText('Plant #18446744073709551617');
  await expect(page.getByRole('region', { name: 'mint-unsafe', exact: true }).locator('summary')).not.toContainText('Plant #');
  await expect(page.getByRole('region', { name: 'attack-missing', exact: true }).locator('summary')).toContainText('Attack outcome unavailable');
  await expect(page.getByRole('region', { name: 'attack-won', exact: true }).locator('summary')).toContainText('Won 1 PTS');
  await expect(page.getByRole('region', { name: 'attack-lost', exact: true }).locator('summary')).toContainText('Lost 1 PTS');
  for (const summary of await records.locator('summary').all()) await summary.click();
  await expect(page.getByRole('region', { name: 'care-legacy', exact: true })).toContainText('A known plant name');
  await expect(page.getByRole('region', { name: 'shop-legacy', exact: true })).toContainText('A plant');
  await expect(page.getByRole('region', { name: 'warehouse-missing', exact: true })).toContainText('a plant');
  await expect(page.getByRole('region', { name: 'land-token-missing', exact: true })).toContainText('A land');
  await expect(page.getByRole('region', { name: 'raid-missing', exact: true })).toContainText('A land attacked A land');
  await expect(page.getByRole('region', { name: 'attack-missing', exact: true })).toContainText('The result is unavailable');
  await expect(page.getByRole('region', { name: 'attack-missing', exact: true })).not.toContainText(/\b(won|lost)\b/i);
  await expect(page.getByRole('region', { name: 'attack-won', exact: true })).toContainText('and won');
  await expect(page.getByRole('region', { name: 'attack-lost', exact: true })).toContainText('and lost');
  await expect(page.locator('main')).not.toContainText(/#(?:undefined|null|NaN)|#\s*·/);
  await expect(page.getByRole('region', { name: 'played-known', exact: true })).toContainText('BoxGame');
});
