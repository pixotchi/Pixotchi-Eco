import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

const ROOTS = ['app', 'components', 'hooks', 'lib'];
const EXTRA_FILES = [
  'eslint.config.mjs',
  'next.config.mjs',
  'postcss.config.mjs',
  'proxy.ts',
  'tailwind.config.ts',
];
const EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx']);
const DEFAULT_CHUNK_SIZE = 50;
const parsedChunkSize = Number(process.env.ESLINT_CHUNK_SIZE);
const CHUNK_SIZE = Number.isInteger(parsedChunkSize) && parsedChunkSize >= 1
  ? parsedChunkSize
  : DEFAULT_CHUNK_SIZE;

/**
 * Locate ESLint's CLI entry so it can be run through the current Node binary.
 *
 * Spawning `./node_modules/.bin/eslint` directly only works on POSIX, where the
 * shim is a symlink with a shebang. On Windows the shim is a `.cmd` file, and
 * routing it through cmd.exe (`shell: true`) fails because cmd cannot resolve a
 * `./`-prefixed path. Running the JS entry with `process.execPath` needs no
 * shell on any platform, which also keeps paths containing spaces safe.
 *
 * ESLint's `exports` map blocks deep-importing `eslint/bin/eslint.js`, but
 * `package.json` is exported and declares the bin path, so resolve through that
 * rather than hardcoding an internal layout.
 */
function resolveEslintCli() {
  const manifestPath = require.resolve('eslint/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const binField = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.eslint;

  if (!binField) {
    throw new Error(`Could not find the ESLint CLI entry in ${manifestPath}`);
  }

  return join(dirname(manifestPath), binField);
}

function hasLintExtension(file) {
  return [...EXTENSIONS].some((extension) => file.endsWith(extension));
}

function collectFiles(path, files = []) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      collectFiles(join(path, entry), files);
    }
    return files;
  }

  if (stat.isFile() && hasLintExtension(path)) {
    files.push(path);
  }
  return files;
}

const files = [
  ...ROOTS.flatMap((root) => collectFiles(root)),
  ...EXTRA_FILES,
];

const eslintCli = resolveEslintCli();

for (let index = 0; index < files.length; index += CHUNK_SIZE) {
  const chunk = files.slice(index, index + CHUNK_SIZE);
  const result = spawnSync(process.execPath, [eslintCli, '--max-warnings=0', ...chunk], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Failed to run ESLint: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
