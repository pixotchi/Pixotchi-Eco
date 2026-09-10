import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { erc20Abi, erc721Abi, parseAbi, type AbiFunction } from 'viem';
import { describeFunction, type DeploymentManifest } from '../../lib/deployment-check';

/** Read the reviewed local ABI declaration without importing app/server modules. */
export function readLocalAbi(file: string, exportName?: string): AbiFunction[] {
  // Only these installed, trusted ABI exports are accepted as package sources.
  // ERC-721 callers use a subset: enumeration is not implemented by every NFT.
  if (file === 'viem:erc20Abi' || file === 'viem:erc721Abi') {
    const functions = (file === 'viem:erc20Abi' ? erc20Abi : erc721Abi)
      .filter(item => item.type === 'function') as AbiFunction[];
    const selected = exportName ? functions.filter(item => item.name === exportName) : functions;
    if (!selected.length) throw new Error(`Missing reviewed ABI ${file}:${exportName}`);
    return selected;
  }
  const source = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const json = JSON.parse(source);
    return (Array.isArray(json) ? json : json.abi).filter((item: { type: string }) => item.type === 'function');
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === exportName) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!initializer) throw new Error(`Missing reviewed ABI ${file}:${exportName}`);
  while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
  if (ts.isCallExpression(initializer) && initializer.expression.getText(tree) === 'parseAbi'
    && initializer.arguments.length === 1 && ts.isArrayLiteralExpression(initializer.arguments[0])) {
    const literals = initializer.arguments[0].elements.map(element => {
      if (!ts.isStringLiteral(element)) throw new Error('Reviewed ABI strings must be literal');
      return element.text;
    });
    return parseAbi(literals).filter(item => item.type === 'function') as AbiFunction[];
  }
  if (!ts.isArrayLiteralExpression(initializer)) throw new Error('Deployment ABIs must be explicit array declarations');
  const javascript = ts.transpile(`(${initializer.getText(tree)})`, { target: ts.ScriptTarget.ES2022 });
  const value = runInNewContext(javascript, Object.create(null), { timeout: 1000 }) as AbiFunction[];
  return value.filter(item => item.type === 'function');
}

export function validateLocalManifest(manifest: DeploymentManifest): string[] {
  const failures: string[] = [];
  for (const contract of manifest.contracts) {
    for (const source of contract.sources) {
      for (const fn of readLocalAbi(source.file, source.exportName)) {
        const actual = describeFunction(fn);
        const reviewed = contract.functions.find(item => item.selector === actual.selector);
        if (!reviewed || reviewed.signature !== actual.signature || JSON.stringify(reviewed.outputs) !== JSON.stringify(actual.outputs)) {
          failures.push(`${contract.id}:${actual.signature}: local ABI requires manifest review`);
        }
      }
    }
  }
  return failures;
}
