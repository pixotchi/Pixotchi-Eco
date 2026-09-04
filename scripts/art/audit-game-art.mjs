import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const projectRoot = process.cwd();
const publicRoot = path.join(projectRoot, 'public');
const outputPath = path.join(publicRoot, 'game-art-v2', 'audit', 'current-asset-usage.json');
const contactSheetPath = path.join(publicRoot, 'game-art-v2', 'audit', 'current-overhaul-candidates.png');
const visualExtensions = new Set(['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.md', '.mjs', '.ts', '.tsx']);
const sourceRoots = ['app', 'components', 'hooks', 'lib'];

const buildingLandPattern = /^\/icons\/(?:map\/|barracks\.webp$|barrackslayer\.webp$|bee-house\.png$|bee-layer\.webp$|casino\.png$|casino-layer\.webp$|farmer-house\.png$|farmerhouse-layer\.webp$|landIcon\.png$|landsapp\.png$|marketplace\.png$|marketplace-layer\.webp$|soil-factory\.png$|soil-layer\.webp$|solar-panels\.png$|solar-layer\.webp$|stake-house\.png$|town-small\.png$|village-(?:big|high|start)\.png$|ware-house\.png$)/i;
const externalBrandPattern = /^\/icons\/(?:Base_|builtOnBase|efp-logo|ethicon|ethlogo|farcaster|github|jessetoken|poet|privy|solana|Telegram|twitter|usdc|x\.|zora)/i;
const firstPartyTokenPattern = /^(?:\/icons\/(?:cc|leaf)\.png|\/PixotchiKit\/COIN\.svg)$/i;
const plantPresentationPattern = /^\/icons\/(?:plant(?:1|2|3WithFrame|4WithFrame|5)\.|plantGrowth)/i;
const tutorialMarketingPattern = /^\/(?:tutorial\/|farcaster-og\.png$|og-image|screenshot|twitter-og\.png$)/i;
const appChromePattern = /^\/(?:PixotchiKit\/|icon1\.png$|icons\/(?:android-chrome|apple-touch-icon|icon-512x512|Logonotext|miniapp|talent|web-app-manifest)|android-chrome|apple-touch-icon|favicon|icon-512x512|mstile|safari-pinned-tab|splash|web-app-manifest)/i;
const featureSurfacePattern = /^\/icons\/(?:bgclaim|cardbj|cardbjfront|casino-bg|casinobj-bg)\./i;

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

function toProjectPath(absolute) {
  return path.relative(projectRoot, absolute).split(path.sep).join('/');
}

function toPublicPath(absolute) {
  return `/${path.relative(publicRoot, absolute).split(path.sep).join('/')}`;
}

function categoryFor(publicPath) {
  if (publicPath.startsWith('/ipfs/strain')) return 'plant-nft-canonical';
  if (buildingLandPattern.test(publicPath)) return 'building-land-excluded';
  if (plantPresentationPattern.test(publicPath)) return 'plant-presentation';
  if (firstPartyTokenPattern.test(publicPath)) return 'first-party-token-brand';
  if (externalBrandPattern.test(publicPath)) return 'official-network-or-token-brand';
  if (tutorialMarketingPattern.test(publicPath)) return 'tutorial-or-marketing';
  if (appChromePattern.test(publicPath)) return 'app-brand-or-chrome';
  if (featureSurfacePattern.test(publicPath)) return 'feature-surface-art';
  return 'game-ui-art';
}

function decisionFor(category, used) {
  if (!used) return 'archive-candidate-after-manual-check';
  if (category === 'building-land-excluded') return 'excluded-from-v2-overhaul';
  if (category === 'plant-nft-canonical') return 'preserve-as-canonical-style-anchor';
  if (category === 'official-network-or-token-brand') return 'preserve-official-mark';
  if (category === 'first-party-token-brand') return 'preserve-token-identity-normalize-framing-only';
  if (category === 'plant-presentation') return 'replace-with-canonical-nft-derived-thumbnail';
  if (category === 'feature-surface-art') return 'refresh-after-core-icon-rollout';
  if (category === 'tutorial-or-marketing') return 'refresh-after-ui-icon-rollout';
  if (category === 'app-brand-or-chrome') return 'separate-brand-review';
  return 'replace-or-normalize-in-v2';
}

const sourceFiles = [];
for (const root of sourceRoots) {
  const directory = path.join(projectRoot, root);
  sourceFiles.push(...(await walk(directory)).filter((file) => sourceExtensions.has(path.extname(file).toLowerCase())));
}
for (const standalone of ['next.config.mjs', 'README.md']) {
  sourceFiles.push(path.join(projectRoot, standalone));
}

const sourceLines = new Map();
for (const file of sourceFiles) {
  const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  sourceLines.set(file, lines);
}

const assetFiles = (await walk(publicRoot))
  .filter((file) => visualExtensions.has(path.extname(file).toLowerCase()))
  .filter((file) => !toProjectPath(file).startsWith('public/game-art-v2/'))
  .sort((a, b) => a.localeCompare(b));

const assets = await Promise.all(assetFiles.map(async (file) => {
  const publicPath = toPublicPath(file);
  const references = [];
  for (const [sourceFile, lines] of sourceLines) {
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(publicPath)) {
        references.push(`${toProjectPath(sourceFile)}:${index + 1}`);
      }
    }
  }

  const dynamicPlantAsset = publicPath.startsWith('/ipfs/strain');
  const used = dynamicPlantAsset || references.length > 0;
  const stat = await fs.stat(file);
  let dimensions = null;
  try {
    const metadata = await sharp(file).metadata();
    if (metadata.width && metadata.height) dimensions = `${metadata.width}x${metadata.height}`;
  } catch {
    dimensions = null;
  }
  const category = categoryFor(publicPath);

  return {
    bytes: stat.size,
    category,
    decision: decisionFor(category, used),
    dimensions,
    extension: path.extname(file).slice(1).toLowerCase(),
    publicPath,
    references,
    usage: dynamicPlantAsset ? 'dynamic-family' : references.length ? 'direct' : 'not-found-in-source-scan',
    used,
  };
}));

const byCategory = Object.fromEntries(
  [...new Set(assets.map((asset) => asset.category))]
    .sort()
    .map((category) => {
      const matches = assets.filter((asset) => asset.category === category);
      return [category, {
        assets: matches.length,
        bytes: matches.reduce((sum, asset) => sum + asset.bytes, 0),
        used: matches.filter((asset) => asset.used).length,
      }];
    }),
);

const report = {
  generatedAt: new Date().toISOString(),
  method: 'Static source scan of public asset path literals plus the dynamic /ipfs/strainN/level.svg family used by components/PlantImage.tsx.',
  scope: 'Existing raster/vector assets under public/, excluding the new public/game-art-v2/ output folder.',
  totals: {
    assets: assets.length,
    bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    directReferences: assets.reduce((sum, asset) => sum + asset.references.length, 0),
    usedAssets: assets.filter((asset) => asset.used).length,
    unreferencedAssets: assets.filter((asset) => !asset.used).length,
  },
  byCategory,
  assets,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

const candidates = assets.filter((asset) => asset.used && ['feature-surface-art', 'game-ui-art', 'plant-presentation'].includes(asset.category));
const columns = 7;
const cellWidth = 164;
const cellHeight = 154;
const rows = Math.ceil(candidates.length / columns);
const sheetWidth = columns * cellWidth;
const sheetHeight = rows * cellHeight;
const sheetBackground = Buffer.from(
  `<svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#dce8ef"/>
    ${candidates.map((asset, index) => {
      const x = (index % columns) * cellWidth;
      const y = Math.floor(index / columns) * cellHeight;
      const dark = index % 2 === 1;
      const panel = dark ? '#243047' : '#f7feff';
      const label = dark ? '#f7feff' : '#231e2b';
      const shortName = path.basename(asset.publicPath).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<rect x="${x + 6}" y="${y + 6}" width="${cellWidth - 12}" height="${cellHeight - 12}" rx="13" fill="${panel}"/>
        <text x="${x + cellWidth / 2}" y="${y + 133}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${label}">${shortName}</text>`;
    }).join('')}
  </svg>`,
);

const candidateBuffers = await Promise.all(candidates.map(async (asset) => {
  const input = path.join(publicRoot, ...asset.publicPath.slice(1).split('/'));
  return sharp(input, { animated: false })
    .resize(92, 92, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: 'contain',
      kernel: sharp.kernel.nearest,
    })
    .png()
    .toBuffer();
}));

await sharp(sheetBackground)
  .composite(candidateBuffers.map((buffer, index) => ({
    input: buffer,
    left: (index % columns) * cellWidth + 36,
    top: Math.floor(index / columns) * cellHeight + 20,
  })))
  .png()
  .toFile(contactSheetPath);

console.log(JSON.stringify({
  outputPath: toProjectPath(outputPath),
  contactSheetPath: toProjectPath(contactSheetPath),
  overhaulCandidates: candidates.length,
  ...report.totals,
  byCategory,
}, null, 2));
