import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

// The reviewed ceiling records existing debt. New files start at zero; reducing
// a ceiling is safe, raising one requires an explicit code-review decision.
const budget = JSON.parse(await readFile(new URL('./frontend-type-boundaries.json', import.meta.url), 'utf8'));
const counts = {};
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (filename.replaceAll('\\', '/') !== 'app/qa') await inspect(filename);
    } else if (/\.tsx?$/.test(filename) && !filename.endsWith('.d.ts')) {
      const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      let count = 0;
      function visit(node) {
        if (node.kind === ts.SyntaxKind.AnyKeyword || (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'UntypedValue')) count++;
        ts.forEachChild(node, visit);
      }
      visit(source);
      if (count) counts[filename.replaceAll('\\', '/')] = count;
    }
  }
}
await Promise.all(['app', 'components', 'hooks', 'lib'].map(inspect));
const violations = Object.entries(counts).filter(([filename, count]) => count > (budget[filename] ?? 0));
assert.equal(violations.length, 0, `Type escape counts increased; add runtime validation and typed data instead:\n${violations.map(([file, count]) => `${file}: ${count} > ${budget[file] ?? 0}`).join('\n')}`);
console.log(`Frontend type boundary ceiling passed: ${Object.values(counts).reduce((sum, count) => sum + count, 0)} existing escape hatches across ${Object.keys(counts).length} files; new files require typed boundaries.`);
