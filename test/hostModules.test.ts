import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The src/resultsView*.ts modules import each other, which is safe only while none of them
// reads a sibling's value, or the host's, while it loads. Rewritten 2026-09-26 as an allow-list
// after the V160 review found the first version passing six constructs, and tightened after the
// V161 review found method decorators, static members calling a local function, and an unusual
// import spelling passing it too.
//
// What it does not do: follow a call into a function's body. So it does not try to. A call or
// `new` at the top level is allowed only when its target comes from outside these modules, such
// as @kren/core or a built-in; a class may have no decorators and no static members.

const HOST = 'resultsView.js';
const MODULE = /^resultsView[^/]*\.js$/u;

/** The module an import names, if it is the host or a split module, however it is spelled. */
function panelModule(specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const normalized = posix.normalize(specifier);
  return MODULE.test(normalized) ? normalized : undefined;
}

function importedNames(source: ts.SourceFile, panel: boolean): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly ||
        !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if ((panelModule(statement.moduleSpecifier.text) !== undefined) !== panel) continue;
    const clause = statement.importClause;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (!element.isTypeOnly) names.add(element.name.text);
    }
  }
  return names;
}

function immediatelyInvoked(node: ts.Node): boolean {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return (ts.isCallExpression(current.parent) || ts.isNewExpression(current.parent)) &&
    current.parent.expression === current;
}

/** The leftmost name of `a.b.c(...)`, `a[0]()` or `a()`, or `this`. */
function rootOf(expression: ts.Expression): string | undefined {
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
    else if (ts.isCallExpression(current)) current = current.expression;
    else break;
  }
  if (current.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  return ts.isIdentifier(current) ? current.text : undefined;
}

function declares(statement: ts.Statement, name: string): boolean {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return statement.name?.text === name;
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === name);
  }
  return false;
}

/** Every place a module reads a sibling's or the host's value, or runs its own code, while it loads. */
export function loadTimeViolations(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const panel = importedNames(source, true);
  const external = importedNames(source, false);
  const line = (node: ts.Node) => `${fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const local = (name: string) => source.statements.some((statement) => declares(statement, name));
  const violations: string[] = [];

  // True when evaluating `node` at load time reads a panel module's value or calls code this
  // guard cannot follow. A function body runs later, so it is skipped, unless the function is
  // invoked on the spot; a computed name is evaluated when its object is built.
  const evaluatesUnsafely = (node: ts.Node): boolean => {
    // A class's `extends` clause parses as a type node but is a value read when the class is defined.
    if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent) &&
        node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent)) {
      return evaluatesUnsafely(node.expression);
    }
    if (ts.isTypeNode(node)) return false;
    if (ts.isFunctionLike(node)) {
      const name = (node as { name?: ts.Node }).name;
      if (name && ts.isComputedPropertyName(name) && evaluatesUnsafely(name)) return true;
      if (!immediatelyInvoked(node)) return false;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const root = rootOf(node.expression);
      const followable = root !== undefined &&
        (external.has(root) || (!panel.has(root) && root !== 'this' && !local(root)));
      if (!followable) return true;
    }
    if (ts.isIdentifier(node) && (panel.has(node.text) || node.text === 'require') &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) return true;
    return ts.forEachChild(node, evaluatesUnsafely) === true;
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      // The host imports every module, so a value imported back from it depends on the host
      // having finished loading. V161 did this with an error class; only types may come.
      const clause = statement.importClause;
      if (clause && !clause.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier) &&
          panelModule(statement.moduleSpecifier.text) === HOST) {
        const bindings = clause.namedBindings;
        if (clause.name !== undefined || (bindings !== undefined &&
            (ts.isNamespaceImport(bindings) || bindings.elements.some((element) => !element.isTypeOnly)))) {
          violations.push(`${line(statement)}: imports a value from the host`);
        }
      }
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      let definesCode = false;
      const scan = (node: ts.Node): void => {
        if (ts.isDecorator(node) || ts.isClassStaticBlockDeclaration(node) ||
            (node !== statement && ts.canHaveModifiers(node) &&
              (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword))) {
          definesCode = true;
        }
        ts.forEachChild(node, scan);
      };
      scan(statement);
      if (definesCode || evaluatesUnsafely(statement)) {
        violations.push(`${line(statement)}: a class may have no decorators or static members, and may not extend a panel module's value`);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) || ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      // The whole declaration, not just its initializer: a destructuring default is evaluated too.
      for (const declaration of statement.declarationList.declarations) {
        if (evaluatesUnsafely(declaration)) {
          violations.push(`${line(declaration)}: evaluates a panel module's value, or its own code, while loading`);
        }
      }
      continue;
    }
    violations.push(`${line(statement)}: ${ts.SyntaxKind[statement.kind]} is not allowed at the top level`);
  }
  return violations;
}

describe('the split panel host modules', () => {
  it('stay inert while loading', () => {
    const modules = readdirSync('src').filter((name) =>
      /^resultsView.*\.ts$/u.test(name) && name !== 'resultsView.ts'
    );
    expect(modules.length).toBeGreaterThan(0);
    const violations = modules.flatMap((name) =>
      loadTimeViolations(name, readFileSync(join('src', name), 'utf8')));
    expect(violations).toEqual([]);
  });

  // The guard proves it can fail on every construct the V160 review found it passing.
  const header = "import { imported } from './resultsViewLive.js';\n";
  it.each([
    ['export default imported;'],
    ['export const x = ((y = imported) => y)();'],
    ['class C { static x = imported; }'],
    ['class C { static { if (imported) {} } }'],
    ['@imported class C {}'],
    ['const { x = imported } = {};'],
    ['const handlers = { [imported]() {} };'],
    ['const handlers = { f: imported };'],
    ['imported();'],
    ['class C extends imported {}'],
    ["import { KrenResultsViewProvider } from './resultsView.js';"],
    ["import { type KrenResultsViewProvider, helper } from './resultsView.js';"],
    ['class C { @imported method() {} }'],
    ['class C { static read() { return imported; } static value = this.read(); }'],
    ['class C { static get value() { return imported; } }'],
    ['class C { constructor() { imported(); } }\nconst c = new C();'],
    ['function read() { return imported; }\nconst x = read();'],
    ['const x = (() => imported).call(null);'],
    ["import { KrenResultsViewProvider } from '././resultsView.js';"],
    ["const x = require('./resultsView.js').KrenResultsViewProvider;"],
  ])('rejects %s', (line) => {
    expect(loadTimeViolations('probe.ts', header + line)).not.toEqual([]);
  });

  it.each([
    ["export { imported } from './resultsViewLive.js';"],
    ['export function f(y = imported) { return imported(y); }'],
    ['const handlers = { f() { return imported(); } };'],
    ['export const LIMIT = 10;'],
    ["import { DEFAULT_PRO_MODELS } from '@kren/core';\nexport const MODEL = DEFAULT_PRO_MODELS.at(-1)!.id;"],
    ['class LocalError extends Error {}'],
    ['class C { run() { return imported(); } }'],
    ["import type { KrenResultsViewProvider } from './resultsView.js';"],
    ["import { type KrenResultsViewProvider } from './resultsView.js';"],
  ])('allows %s', (line) => {
    expect(loadTimeViolations('probe.ts', header + line)).toEqual([]);
  });
});
