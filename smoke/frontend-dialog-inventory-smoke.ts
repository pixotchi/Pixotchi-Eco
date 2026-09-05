import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const inventoryPath = 'docs/qa/frontend-dialog-coverage-2026-09-05.csv';
const csv = readFileSync(inventoryPath, 'utf8').trim().split(/\r?\n/);
function fields(line: string): string[] {
  return (line.match(/"(?:[^"]|"")*"|[^,]+/g) ?? []).map(field => field.replace(/^"|"$/g, '').replaceAll('""', '"'));
}
const headers = fields(csv.shift()!);
const rows = csv.map(line => Object.fromEntries(fields(line).map((value, index) => [headers[index], value])));
const actual = new Map<string, number>();
function visitDirectory(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) { if (file !== 'app/qa') visitDirectory(file); continue; }
    if (!file.endsWith('.tsx')) continue;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'DialogContent') actual.set(file, (actual.get(file) ?? 0) + 1);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
visitDirectory('app'); visitDirectory('components');
const documented = new Map<string, number>();
for (const row of rows) {
  assert.ok(row.Surface, 'Every dialog needs a player-facing identity');
  assert.ok(row.Justification?.trim(), `${row.Surface}: record the remaining integration boundary explicitly`);
  const fixtures = row.FixtureFiles?.split(';').filter(Boolean) ?? [];
  assert.ok(fixtures.length, `${row.Surface}: name the shared or direct regression suite`);
  for (const fixture of fixtures) assert.ok(existsSync(fixture), `${row.Surface}: missing regression suite ${fixture}`);
  documented.set(row.File, (documented.get(row.File) ?? 0) + 1);
}
assert.deepEqual([...actual].sort(), [...documented].sort(), 'New/removed dialog call sites require an inventory entry and coverage decision');
assert.equal(new Set(rows.map(row => row.Surface)).size, rows.length, 'Dialog identities must remain distinct');
console.log(`Frontend inventory passed: all ${rows.length} production dialog call sites have a named suite and explicit integration justification.`);
