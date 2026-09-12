import { Module } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';

let sequence = 0;
/** Compile real modules, replacing only explicitly named external boundaries. */
export async function loadSource(file, mocks = {}) {
  const slot = `__sourceSmoke${++sequence}`;
  globalThis[slot] = mocks;
  const compiled = await build({ entryPoints: [resolve(file)], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', target: 'node24', logLevel: 'silent',
    plugins: [{ name: 'smoke-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: 'smoke-mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'smoke-mock' }, args => ({
        contents: Object.keys(mocks[args.path]).map(key =>
          `export const ${key} = globalThis[${JSON.stringify(slot)}][${JSON.stringify(args.path)}][${JSON.stringify(key)}];`
        ).join('\n'), loader: 'js',
      }));
    } }],
  });
  const filename = resolve(`smoke/memory-${sequence}.cjs`);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(compiled.outputFiles[0].text, filename);
  return mod.exports;
}
