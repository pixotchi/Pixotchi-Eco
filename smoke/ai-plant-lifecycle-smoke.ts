import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { READ_ONLY_AGENT_SYSTEM_PROMPT } from '../lib/ai-context';

const DEFAULT_HIGH_ASSET_ADDRESS = '0xaa31f93b514fc817210bf7b31ea8a118c7f00312';
const DEFAULT_KILLED_PLANT_OWNER_ADDRESS = '0x2b6bb031ad45e2d5e6a715e50a3f67d1c10ea5b9';

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
  return result.data;
}

async function getHighAssetAddresses(): Promise<string[]> {
  const addresses = new Set<string>([
    process.env.AI_PLANT_LIFECYCLE_SMOKE_ADDRESS || DEFAULT_HIGH_ASSET_ADDRESS,
    process.env.AI_PLANT_LIFECYCLE_KILLED_OWNER_ADDRESS || DEFAULT_KILLED_PLANT_OWNER_ADDRESS,
  ]);

  try {
    const { getAliveTokenIds, getLandLeaderboard, getPlantsInfoExtended } = await import('../lib/contracts');
    const leaderboard = await getLandLeaderboard();
    const counts = new Map<string, number>();
    for (const entry of leaderboard) {
      const owner = String(entry.owner || '').toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(owner)) {
        counts.set(owner, (counts.get(owner) || 0) + 1);
      }
    }

    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([owner]) => addresses.add(owner));

    const plantIds = (await getAliveTokenIds()).slice(0, 500);
    const plants = plantIds.length ? await getPlantsInfoExtended(plantIds) : [];
    const plantOwnerCounts = new Map<string, number>();
    for (const plant of plants) {
      const owner = String(plant.owner || '').toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(owner)) {
        plantOwnerCounts.set(owner, (plantOwnerCounts.get(owner) || 0) + 1);
      }
    }

    [...plantOwnerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([owner]) => addresses.add(owner));
  } catch (error) {
    console.warn('Could not load leaderboard owners for extra lifecycle smoke addresses:', error);
  }

  return [...addresses].slice(0, 4);
}

function compactLifecycleAudit(data: UntypedValue) {
  return {
    address: data.address,
    currentOwnership: {
      requestedPlantsOwnedNow: data.currentOwnership?.requestedPlantsOwnedNow,
      totalCurrentPlants: data.currentOwnership?.totalCurrentPlants,
    },
    explanations: data.explanations,
    indexedKills: (data.indexedLifecycle?.killeds || []).slice(0, 5),
    indexedWalletLifecycle: {
      burnedOrKilledPlants: (data.indexedWalletLifecycle?.burnedOrKilledPlants || []).slice(0, 5),
      mints: (data.indexedWalletLifecycle?.mints || []).slice(0, 5),
      transfers: (data.indexedWalletLifecycle?.transfers || []).slice(0, 5),
    },
    recentBurns: (data.recentWalletPlantTransfers?.burnOrRemovalTransfers || []).slice(0, 5),
    recentMints: (data.recentWalletPlantTransfers?.mintsToWallet || []).slice(0, 5),
    rewardRules: data.rewardRules,
  };
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required for lifecycle smoke answers.');
  }

  const { createReadOnlyAITools } = await import('../lib/ai-read-tools');
  const addresses = await getHighAssetAddresses();
  const audits: UntypedValue[] = [];

  for (const address of addresses) {
    const tools = createReadOnlyAITools({ userAddress: address });
    const audit = getToolData(await (tools.get_plant_lifecycle_audit as UntypedValue).execute({
      address,
      includeRecentTransferFallback: true,
      limit: 12,
    }), 'get_plant_lifecycle_audit');

    assert(typeof audit.currentOwnership?.totalCurrentPlants === 'number', `Lifecycle audit missing current ownership for ${address}.`);
    assert(Array.isArray(audit.explanations), `Lifecycle audit missing explanations for ${address}.`);
    assert(audit.rewardRules?.automaticOnKillBurn === true, `Lifecycle audit missing automatic reward rule for ${address}.`);
    audits.push(compactLifecycleAudit(audit));
  }
  assert(audits.some((audit) => audit.indexedWalletLifecycle?.burnedOrKilledPlants?.length > 0), 'Lifecycle smoke did not find any wallet-indexed burned/killed plant evidence.');

  const model = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(
    process.env.AI_SMOKE_MODEL || 'gemini-3.5-flash',
  );
  const auditContext = JSON.stringify(audits, null, 2);
  const scenarios = [
    {
      assert: (text: string) => /plant id|transaction hash|tx hash|current|mint/i.test(text),
      name: 'minted_missing',
      prompt: 'A player says: "I minted a plant but I cannot see it now. Did I ever mint, or did it disappear?" Explain what the audit can and cannot prove.',
    },
    {
      assert: (text: string) => /automatic/i.test(text) && /ETH/i.test(text) && /reward/i.test(text),
      name: 'burn_reward_reassurance',
      prompt: 'A player is panicking: "If my dead plant was killed or burned, did I lose the ETH rewards?" Explain the reward behavior and verification limit.',
    },
    {
      assert: (text: string) => /TOD/i.test(text) && /dead/i.test(text) && /kill|burn/i.test(text),
      name: 'tod_disappearance',
      prompt: 'A player asks why TOD made their plant vanish. Explain TOD death versus dead-plant kill/burn.',
    },
  ];

  const answers: Record<string, { finishReason: string; text: string }> = {};
  for (const scenario of scenarios) {
    const result = await generateText({
      maxOutputTokens: 2048,
      messages: [
        {
          content: [
            scenario.prompt,
            'Use this sanitized read-only lifecycle audit evidence:',
            auditContext,
            'Answer as Neural Seed in at most 5 short sentences. Stay read-only. If evidence is incomplete, ask for a plant ID or transaction hash.',
          ].join('\n\n'),
          role: 'user',
        },
      ],
      model,
      system: READ_ONLY_AGENT_SYSTEM_PROMPT,
    });
    answers[scenario.name] = {
      finishReason: result.finishReason,
      text: result.text,
    };
    assert(result.finishReason !== 'length', `Lifecycle answer hit length for ${scenario.name}: ${result.text}`);
    assert(scenario.assert(result.text), `Lifecycle answer did not satisfy ${scenario.name}: ${result.text}`);
  }

  console.log(JSON.stringify({
    addresses,
    auditCount: audits.length,
    answers,
    ok: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
