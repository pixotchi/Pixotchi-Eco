import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_WHALE_ADDRESS = '0xaa31f93b514fc817210bf7b31ea8a118c7f00312';

function loadEnvFile(fileName: string) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getToolData(result: UntypedValue, toolName: string) {
  assert(result?.status === 'ok', `${toolName} failed: ${result?.error || 'unknown error'}`);
  assert(typeof result?.source === 'string' && result.source.length > 0, `${toolName} missing source metadata.`);
  assert(typeof result?.fetchedAt === 'string' && result.fetchedAt.length > 0, `${toolName} missing fetchedAt metadata.`);
  assert(Array.isArray(result?.limitations), `${toolName} missing limitations metadata.`);
  return result.data;
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const { createReadOnlyAITools } = await import('../lib/ai-read-tools');
  const address = process.env.AI_NEW_TOOLS_SMOKE_ADDRESS || DEFAULT_WHALE_ADDRESS;
  const tools = createReadOnlyAITools({ userAddress: address });

  const production = getToolData(await (tools.get_land_production_audit as UntypedValue).execute({
    address,
    includePerBuilding: false,
    limit: 5,
  }), 'get_land_production_audit');
  assert(production.auditedLandCount > 0, 'Production audit did not scan any lands for the whale wallet.');
  assert(production.totals?.buildingProduction, 'Production audit missing totals.');

  const raids = getToolData(await (tools.get_land_raid_targets as UntypedValue).execute({
    address,
    includePreviews: false,
    limit: 5,
    previewTargetLimit: 0,
  }), 'get_land_raid_targets');
  assert(typeof raids.ownedLandCount === 'number' && raids.ownedLandCount > 0, 'Land raid targets missing owned land count.');
  assert(Array.isArray(raids.results), 'Land raid targets missing result array.');

  const raidReports = getToolData(await (tools.get_land_raid_reports as UntypedValue).execute({
    address,
    limit: 5,
  }), 'get_land_raid_reports');
  assert(typeof raidReports.scannedLandCount === 'number', 'Land raid reports missing scanned land count.');
  assert(typeof raidReports.summary?.totalReports === 'number', 'Land raid reports missing summary.');

  const questReadiness = getToolData(await (tools.get_quest_readiness as UntypedValue).execute({
    address,
    limit: 5,
  }), 'get_quest_readiness');
  assert(typeof questReadiness.scannedLandCount === 'number', 'Quest readiness missing scanned land count.');
  assert(questReadiness.rewardsPool, 'Quest readiness missing rewards pool status.');

  const casino = getToolData(await (tools.get_casino_status as UntypedValue).execute({
    address,
    includeBlackjack: true,
    includeRoulette: true,
    limit: 5,
  }), 'get_casino_status');
  assert(typeof casino.scannedLandCount === 'number', 'Casino status missing scanned land count.');
  assert(casino.configs, 'Casino status missing config block.');

  const blackjackActions = getToolData(await (tools.get_blackjack_action_state as UntypedValue).execute({
    address,
    limit: 5,
  }), 'get_blackjack_action_state');
  assert(typeof blackjackActions.scannedLandCount === 'number', 'Blackjack action state missing scanned land count.');
  assert(blackjackActions.summary, 'Blackjack action state missing summary.');

  const marketplace = getToolData(await (tools.get_marketplace_orders as UntypedValue).execute({
    address,
    includeInactive: false,
    includeMyOrders: true,
    limit: 5,
  }), 'get_marketplace_orders');
  assert(marketplace.orderBook?.activeOrderCount !== undefined, 'Marketplace orders missing order book summary.');
  assert(Array.isArray(marketplace.orderBook?.asks), 'Marketplace orders missing asks.');
  assert(Array.isArray(marketplace.orderBook?.bids), 'Marketplace orders missing bids.');

  const daily = getToolData(await (tools.get_daily_task_plan as UntypedValue).execute({
    address,
    suggestionLimit: 5,
  }), 'get_daily_task_plan');
  assert(daily.taskCounts?.total >= 10, 'Daily task plan missing task counts.');
  assert(Array.isArray(daily.suggestedNext), 'Daily task plan missing suggestions.');

  const allowances = getToolData(await (tools.get_known_allowances as UntypedValue).execute({
    address,
    includeZeroAllowances: false,
  }), 'get_known_allowances');
  assert(allowances.knownOnly === true, 'Known allowances must be known-only.');
  assert(typeof allowances.tokenCount === 'number' && allowances.tokenCount >= 6, 'Known allowances missing token coverage.');

  const mintAvailability = getToolData(await (tools.get_mint_availability as UntypedValue).execute({
    address,
    includeLand: true,
    includePlants: true,
  }), 'get_mint_availability');
  assert(Array.isArray(mintAvailability.plantStrains), 'Mint availability missing plant strains.');
  assert(mintAvailability.summary, 'Mint availability missing summary.');

  const careAudit = getToolData(await (tools.get_plant_care_audit as UntypedValue).execute({
    address,
    includePrices: true,
    limit: 5,
  }), 'get_plant_care_audit');
  assert(typeof careAudit.plantSummary?.totalPlants === 'number', 'Plant care audit missing plant summary.');
  assert(careAudit.careOptions, 'Plant care audit missing care options.');

  const lifecycleAudit = getToolData(await (tools.get_plant_lifecycle_audit as UntypedValue).execute({
    address,
    includeRecentTransferFallback: true,
    limit: 10,
  }), 'get_plant_lifecycle_audit');
  assert(typeof lifecycleAudit.currentOwnership?.totalCurrentPlants === 'number', 'Plant lifecycle audit missing current ownership.');
  assert(Array.isArray(lifecycleAudit.explanations), 'Plant lifecycle audit missing explanations.');
  assert(lifecycleAudit.rewardRules?.automaticOnKillBurn === true, 'Plant lifecycle audit missing burn reward rule.');

  const arcadeStatus = getToolData(await (tools.get_arcade_status as UntypedValue).execute({
    address,
    limit: 5,
  }), 'get_arcade_status');
  assert(Array.isArray(arcadeStatus.rewardTable), 'Arcade status missing reward table.');
  assert(arcadeStatus.summary, 'Arcade status missing summary.');

  const claims = getToolData(await (tools.get_claim_eligibility as UntypedValue).execute({
    address,
  }), 'get_claim_eligibility');
  assert(typeof claims.airdrop?.eligible === 'boolean', 'Claim eligibility missing airdrop flag.');
  assert(typeof claims.verifyFreePlant?.enabled === 'boolean', 'Claim eligibility missing verify flag.');

  const appStatus = getToolData(await (tools.get_app_status as UntypedValue).execute({
    forceRefresh: false,
  }), 'get_app_status');
  assert(appStatus.overall, 'App status missing overall status.');
  assert(Array.isArray(appStatus.services), 'App status missing services.');

  const bridge = getToolData(await (tools.get_bridge_status as UntypedValue).execute({
    address,
    includeTwinBalances: false,
  }), 'get_bridge_status');
  assert(bridge.bridge?.baseChainId === 8453, 'Bridge status missing Base chain id.');

  console.log(JSON.stringify({
    address,
    auditedLandCount: production.auditedLandCount,
    arcadePlantsChecked: arcadeStatus.count,
    blackjackLandsChecked: blackjackActions.lands.length,
    casinoLandsInScan: casino.totalCasinoLandsInScan,
    dailySuggestions: daily.suggestedNext.length,
    lifecycleExplanations: lifecycleAudit.explanations.length,
    marketplaceActiveOrders: marketplace.orderBook.activeOrderCount,
    mintablePlantStrains: mintAvailability.summary.mintablePlantStrains,
    ok: true,
    questLandsChecked: questReadiness.lands.length,
    raidReports: raidReports.summary.totalReports,
    raidReadyAttackers: raids.readyAttackerCount,
    urgentCareCount: careAudit.urgentCareCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
