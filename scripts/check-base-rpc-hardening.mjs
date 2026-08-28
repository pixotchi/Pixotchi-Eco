import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWED_VIEM_IMPORT_FILES = new Set([
  // Dedicated AI read-only RPC client. This intentionally bypasses the app RPC
  // cluster so AI traffic can use AI_BASE_RPC_URL plus a public fallback.
  'lib/ai-rpc.ts',
  'lib/base-rpc.ts',
  'lib/rpc-transport.ts',
]);
const IGNORED_PREFIXES = [
  '.git/',
  '.next/',
  'node_modules/',
];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const SCAN_ROOTS = ['app', 'components', 'hooks', 'lib', 'scripts'];

const errors = [];

const shouldIgnore = (relativePath) => {
  return IGNORED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
};

const collectFiles = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = path.join(dir, entry);
    const relativePath = path.relative(REPO_ROOT, absolutePath).replaceAll(path.sep, '/');

    if (shouldIgnore(relativePath)) {
      continue;
    }

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      collectFiles(absolutePath, files);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      files.push(relativePath);
    }
  }

  return files;
};

const fileContents = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

for (const root of SCAN_ROOTS) {
  const absoluteRoot = path.join(REPO_ROOT, root);
  try {
    statSync(absoluteRoot);
  } catch {
    continue;
  }

  for (const relativePath of collectFiles(absoluteRoot)) {
  const source = fileContents(relativePath);
  const importsDirectBaseClient = /import\s*\{[^}]*\b(createPublicClient|http)\b[^}]*\}\s*from\s*['"]viem['"]/.test(source);

  if (importsDirectBaseClient && !ALLOWED_VIEM_IMPORT_FILES.has(relativePath)) {
    errors.push(
      `${relativePath}: direct viem createPublicClient/http import detected. Use lib/base-rpc.ts instead.`,
    );
  }
  }
}

const contractsPath = 'lib/contracts.ts';
const contractsSource = fileContents(contractsPath);
const retryMarker = 'retryWithBackoff(async () => {';
let searchIndex = 0;
while (true) {
  const markerIndex = contractsSource.indexOf(retryMarker, searchIndex);
  if (markerIndex === -1) {
    break;
  }

  const blockStart = contractsSource.indexOf('{', markerIndex);
  let depth = 0;
  let blockEnd = blockStart;
  for (; blockEnd < contractsSource.length; blockEnd += 1) {
    const character = contractsSource[blockEnd];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        blockEnd += 1;
        break;
      }
    }
  }

  const blockSource = contractsSource.slice(blockStart, blockEnd);
  if (/walletClient\.(?:writeContract|sendTransaction)\s*\(/.test(blockSource)) {
    const lineNumber = contractsSource.slice(0, markerIndex).split('\n').length;
    errors.push(
      `${contractsPath}:${lineNumber}: walletClient.writeContract/sendTransaction is wrapped in retryWithBackoff. Broadcasts must happen exactly once.`,
    );
  }

  searchIndex = blockEnd;
}

if (errors.length > 0) {
  console.error('Base RPC hardening checks failed:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Base RPC hardening checks passed.');
