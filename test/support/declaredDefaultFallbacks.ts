import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Check the actual source defaults without starting VS Code or a Vitest worker. */
export function assertDeclaredDefaultFallbacks(): void {
  const properties = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
  const parse = (path: string) => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const panel = parse('src/panelSettings.ts');
  const tutor = parse('src/tutor/defaults.ts');
  const constants = new Map<string, unknown>();
  const literal = (node: ts.Expression): unknown => {
    if (ts.isStringLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    throw new Error(`Unexpected default expression: ${node.getText()}`);
  };
  const visitConstants = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ['READ_ALOUD_EDGE_VOICE_DEFAULT', 'RESULTS_OPEN_AT_STARTUP_DEFAULT'].includes(node.name.text)) {
      constants.set(node.name.text, literal(node.initializer));
    }
    ts.forEachChild(node, visitConstants);
  };
  visitConstants(panel);
  const visitTutor = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === 'tutor.readAloud.provider') {
      constants.set("TUTOR_DEFAULTS.configuration['tutor.readAloud.provider']", literal(node.initializer));
    }
    ts.forEachChild(node, visitTutor);
  };
  visitTutor(tutor);
  const expressions: Record<string, string> = {
    'readAloud.edgeVoice': 'READ_ALOUD_EDGE_VOICE_DEFAULT',
    'results.openAtStartup': 'RESULTS_OPEN_AT_STARTUP_DEFAULT',
    'tutor.readAloud.provider': "TUTOR_DEFAULTS.configuration['tutor.readAloud.provider']"
  };
  const counts = new Map<string, number>();
  for (const [key, expression] of Object.entries(expressions)) {
    assert(constants.has(expression), `Missing shared default: ${expression}`);
    assert.equal(constants.get(expression), properties[`kren.${key}`].default, `${key}: shared default disagrees with manifest`);
  }
  const scan = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const source = parse(path);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
            : ts.isIdentifier(node.expression) ? node.expression.text : '';
          const key = node.arguments[0].text;
          if ((method === 'get' || method === 'getDefault') && Object.hasOwn(expressions, key)) {
            const fallback = node.arguments[1];
            assert(fallback, `${path}: ${key} is missing its fallback`);
            const expression = fallback.getText(source);
            const value = constants.has(expression) ? constants.get(expression) : literal(fallback);
            assert.equal(value, properties[`kren.${key}`].default, `${path}: ${key} fallback disagrees with manifest`);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  scan('src');
  for (const key of Object.keys(expressions)) assert((counts.get(key) ?? 0) > 0, `No fallback checked for ${key}`);
}
