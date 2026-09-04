import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const projectRoot = process.cwd();
const artRoot = path.join(projectRoot, 'public', 'game-art-v2');
const sourceDir = path.join(projectRoot, 'art-source', 'game-art-v2');
const itemDir = path.join(artRoot, 'icons', 'items');
const arcadeDir = path.join(artRoot, 'icons', 'arcade');
const previewDir = path.join(artRoot, 'previews');
const semanticGroups = ['navigation', 'status', 'resources', 'combat', 'actions'];

const arcadeNames = new Set(['arcade', 'spin-leaf']);

function isConnectedBackdrop(r, g, b) {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min >= 214 && max - min <= 14;
}

async function removeBakedCheckerboard(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    const pixel = index * channels;
    if (!isConnectedBackdrop(data[pixel], data[pixel + 1], data[pixel + 2])) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * channels + 3] = 0;
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  return sharp(data, { raw: info }).png().toBuffer();
}

async function normalizedMaster(input) {
  const metadata = await sharp(input).metadata();
  if (metadata.hasAlpha) return sharp(input).png().toBuffer();
  return removeBakedCheckerboard(input);
}

async function makeVariant(master, size) {
  const inner = Math.round(size * 0.875);
  const marginStart = Math.floor((size - inner) / 2);
  const marginEnd = size - inner - marginStart;

  return sharp(master)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(inner, inner, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: 'contain',
      kernel: sharp.kernel.nearest,
    })
    .extend({
      top: marginStart,
      bottom: marginEnd,
      left: marginStart,
      right: marginEnd,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ palette: true, colours: 32, dither: 0 })
    .toBuffer();
}

async function buildPreview(entries, outputFile) {
  const columns = 4;
  const cellWidth = 192;
  const cellHeight = 220;
  const rows = Math.ceil(entries.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const background = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#dce8ef"/>
      ${entries.map((entry, index) => {
        const x = (index % columns) * cellWidth;
        const y = Math.floor(index / columns) * cellHeight;
        const panel = index % 2 === 0 ? '#f7feff' : '#243047';
        const label = index % 2 === 0 ? '#231e2b' : '#f7feff';
        return `<rect x="${x + 8}" y="${y + 8}" width="${cellWidth - 16}" height="${cellHeight - 16}" rx="16" fill="${panel}"/>
          <text x="${x + cellWidth / 2}" y="${y + 198}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="${label}">${entry.name}</text>`;
      }).join('')}
    </svg>`,
  );

  const composites = entries.map((entry, index) => ({
    input: entry.buffer,
    left: (index % columns) * cellWidth + 32,
    top: Math.floor(index / columns) * cellHeight + 24,
  }));

  await sharp(background)
    .composite(composites)
    .png()
    .toFile(path.join(previewDir, outputFile));
}

async function buildVectorItemPreview() {
  const entries = [];
  for (const directory of [itemDir, arcadeDir]) {
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.svg')).sort();
    for (const file of files) {
      const input = path.join(directory, file);
      const buffer = await sharp(input)
        .resize(128, 128, { fit: 'contain', kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      entries.push({ name: file.replace(/\.svg$/, ''), buffer });
    }
  }

  await buildPreview(entries, 'vector-item-set.png');
}

async function buildSemanticPreview() {
  const entries = [];
  for (const group of semanticGroups) {
    const directory = path.join(artRoot, 'icons', group);
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.svg')).sort();
    for (const file of files) {
      const input = path.join(directory, file);
      const buffer = await sharp(input)
        .resize(96, 96, { fit: 'contain', kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      entries.push({ name: `${group}/${file.replace(/\.svg$/, '')}`, buffer });
    }
  }

  const columns = 5;
  const cellWidth = 160;
  const cellHeight = 170;
  const rows = Math.ceil(entries.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const background = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#dce8ef"/>
      ${entries.map((entry, index) => {
        const x = (index % columns) * cellWidth;
        const y = Math.floor(index / columns) * cellHeight;
        const panel = index % 2 === 0 ? '#f7feff' : '#243047';
        const label = index % 2 === 0 ? '#231e2b' : '#f7feff';
        return `<rect x="${x + 7}" y="${y + 7}" width="${cellWidth - 14}" height="${cellHeight - 14}" rx="14" fill="${panel}"/>
          <text x="${x + cellWidth / 2}" y="${y + 145}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${label}">${entry.name}</text>`;
      }).join('')}
    </svg>`,
  );

  await sharp(background)
    .composite(entries.map((entry, index) => ({
      input: entry.buffer,
      left: (index % columns) * cellWidth + 32,
      top: Math.floor(index / columns) * cellHeight + 24,
    })))
    .png()
    .toFile(path.join(previewDir, 'semantic-icon-set.png'));
}

await Promise.all([itemDir, arcadeDir, previewDir].map((directory) => fs.mkdir(directory, { recursive: true })));

const sources = (await fs.readdir(sourceDir))
  .filter((file) => file.endsWith('-master.png'))
  .sort();

const previewEntries = [];
for (const source of sources) {
  const name = source.replace(/-master\.png$/, '');
  const input = path.join(sourceDir, source);
  const outputDir = arcadeNames.has(name) ? arcadeDir : itemDir;
  const master = await normalizedMaster(input);
  const icon128 = await makeVariant(master, 128);
  const icon256 = await makeVariant(master, 256);

  await Promise.all([
    fs.writeFile(path.join(outputDir, `${name}.png`), icon128),
    fs.writeFile(path.join(outputDir, `${name}@2x.png`), icon256),
  ]);

  previewEntries.push({ name, buffer: icon128 });
}

await buildPreview(previewEntries, 'generated-item-set.png');
await buildVectorItemPreview();
await buildSemanticPreview();
console.log(`Prepared ${sources.length * 2} legacy PNG fallbacks and rebuilt generated, vector, and semantic preview sheets.`);
