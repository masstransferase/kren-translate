import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Members of KrenResultsViewProvider without `private` are shared with the src/resultsView*.ts
// modules, and nothing outside them may reach those members. extension.ts holds the provider as
// KrenResultsViewPanel, a Pick of the public methods. Rewritten 2026-09-26 after the V160 review
// showed the first version checking one declaration's spelling while a second variable, a chained
// assignment or a cast still reached the internals. So outside the host modules the class name
// may appear only in an import, and once as `resultsView = new KrenResultsViewProvider(...)`
// standing as a statement of its own, where the result goes straight into the narrow variable.

const CLASS = 'KrenResultsViewProvider';
// Public static constants name the view to VS Code and reveal nothing of an instance.
const STATICS = new Set(['viewId', 'enabledContext']);

/** Every use of the class name that would let code outside the host reach its internals. */
export function providerLeaks(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const line = (node: ts.Node) => `${fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const leaks: string[] = [];
  let constructions = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === CLASS) {
      const parent = node.parent;
      const inImport = ts.isImportSpecifier(parent) || ts.isImportClause(parent);
      const construction = ts.isNewExpression(parent) && parent.expression === node &&
        ts.isBinaryExpression(parent.parent) && parent.parent.right === parent &&
        parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(parent.parent.left) && parent.parent.left.text === 'resultsView' &&
        ts.isExpressionStatement(parent.parent.parent);
      const staticConstant = ts.isPropertyAccessExpression(parent) && parent.expression === node &&
        STATICS.has(parent.name.text);
      if (construction) constructions += 1;
      else if (!inImport && !staticConstant) leaks.push(`${line(node)}: ${CLASS} used outside the host`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (constructions > 1) leaks.push(`${fileName}: ${CLASS} constructed ${constructions} times`);
  return leaks;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/u.test(name) ? [path] : [];
  });
}

describe('the panel host boundary', () => {
  it('declares the extension panel variable with the narrow type', () => {
    const source = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'),
      ts.ScriptTarget.Latest, true);
    const variables = source.statements.filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations]);
    const panel = variables.find((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === 'resultsView');
    expect(panel).toBeDefined();
    expect(panel?.type && ts.isTypeReferenceNode(panel.type) &&
      panel.type.typeName.getText(source)).toBe('KrenResultsViewPanel');
  });

  it('lets nothing outside the host modules hold the provider by its class', () => {
    const outside = sourceFiles('src').filter((path) => !/[\\/]resultsView[^\\/]*\.ts$/u.test(path));
    expect(outside).toContain(join('src', 'extension.ts'));
    const text = readFileSync(join('src', 'extension.ts'), 'utf8');
    expect(text).toContain(`resultsView = new ${CLASS}(`);
    expect(outside.flatMap((path) => providerLeaks(path, readFileSync(path, 'utf8')))).toEqual([]);
  });

  // The guard proves it can fail on each bypass the V160 review demonstrated.
  const header = `import { ${CLASS} } from './resultsView.js';\nlet resultsView: unknown;\n`;
  it.each([
    [`const internalView = new ${CLASS}({});`],
    [`const internalView = resultsView = new ${CLASS}({});`],
    [`(resultsView as ${CLASS}).dispose();`],
    [`function f(view: ${CLASS}) { return view; }`],
    [`const methods = ${CLASS}.prototype;`],
    [`resultsView = new ${CLASS}({});\nresultsView = new ${CLASS}({});`],
  ])('rejects %s', (line) => {
    expect(providerLeaks('probe.ts', header + line)).not.toEqual([]);
  });

  it('allows the one construction into the narrow variable, and the static view names', () => {
    expect(providerLeaks('probe.ts', `${header}resultsView = new ${CLASS}({});`)).toEqual([]);
    expect(providerLeaks('probe.ts', `${header}const id = ${CLASS}.viewId + ${CLASS}.enabledContext;`)).toEqual([]);
  });
});
