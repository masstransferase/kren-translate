import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const NOTIFICATION_NAMES = new Set([
  // 2026-10-12: The panel wrappers retain the same awaited confirmation contract.
  'showKrenWarningMessage',
  'showKrenErrorMessage',
  'showInformationMessage',
  'showWarningMessage',
  'showErrorMessage'
]);
const AWAITED_PROMPT_NAMES = new Set([
  ...NOTIFICATION_NAMES,
  'showInputBox',
  'showQuickPick',
  'showOpenDialog',
  'showSaveDialog'
]);

interface SourceRecord {
  file: string;
  source: string;
  sourceFile: ts.SourceFile;
}

function sourceRecords(directory = 'src'): SourceRecord[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceRecords(file);
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
    const source = readFileSync(file, 'utf8');
    return [{
      file,
      source,
      sourceFile: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    }];
  });
}

function callsNamed(record: SourceRecord, names: ReadonlySet<string>): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) &&
        names.has(node.expression.name.text) || ts.isIdentifier(node.expression) && names.has(node.expression.text))) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(record.sourceFile);
  return calls;
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
      return current.name?.getText();
    }
    current = current.parent;
  }
  return undefined;
}

describe('notification timing contract', () => {
  const records = sourceRecords();

  it('has no bare awaited notification in any source file', () => {
    const bareAwait = /^\s*await\s+vscode\.window\.show(?:Information|Warning|Error)Message\(/gmu;
    const offenders = records.flatMap(({ file, source }) =>
      [...source.matchAll(bareAwait)].map((match) => `${file}:${source.slice(0, match.index).split(/\r?\n/u).length}`)
    );

    expect(offenders).toEqual([]);
  });

  /*
   * The count moved from 24 to 28 across 1.7.8 and 1.7.9, as Default Setting and Reset KREN
   * each gained two confirmations, and to 30 in 1.8.5 with the AI English Tutor Reset
   * confirmation. It reached 31 before V63, whose passage-analysis choice makes 32.
   * V74 returns it to 31 because adding a Primary preserves the existing targets and
   * removes the replacement confirmation from updateTutorTarget. The Find choice remains.
   * The number is not the point of the test and never was: the loop
   * below is, and it fails if any awaited prompt drops its result. The count is here so an
   * accidental new prompt has to be acknowledged rather than absorbed.
   */
  it('keeps every genuine awaited prompt assigned to a result', () => {
    const awaitedPrompts = records.flatMap((record) =>
      callsNamed(record, AWAITED_PROMPT_NAMES).filter((call) => ts.isAwaitExpression(call.parent))
    );

    // Changed 2026-10-04: V205 adds the awaited lesson-source modal so Source reverts after it closes.
    // 2026-10-11: V219 adds the consent prompt shared by Groq and Cloudflare.
    // Changed 2026-10-16: V249, F12a, the edge-tts update adds one awaited confirmation prompt.
    expect(awaitedPrompts).toHaveLength(37);
    for (const call of awaitedPrompts) {
      const awaited = call.parent as ts.AwaitExpression;
      expect(ts.isVariableDeclaration(awaited.parent)).toBe(true);
    }
  });

  it('routes every ignored notification result through notify', () => {
    const directIgnoredCalls = records.flatMap((record) =>
      callsNamed(record, NOTIFICATION_NAMES).filter((call) => {
        if (enclosingFunctionName(call) === 'notify') return false;
        if (ts.isAwaitExpression(call.parent)) return ts.isExpressionStatement(call.parent.parent);
        return ts.isVoidExpression(call.parent) || ts.isExpressionStatement(call.parent);
      })
    );

    expect(directIgnoredCalls).toEqual([]);
  });

  it('keeps representative notification text byte-identical', () => {
    const source = records.map((record) => record.source).join('\n');
    // "KREN result copied." was deliberately removed in 1.3.2: the copy buttons confirm
    // themselves, so copying raises nothing at all. Asserting its absence keeps a future
    // change from quietly restoring the notification that froze the panel.
    expect(source).not.toContain("'KREN result copied.'");
    expect(source).toContain("'The original selection changed, so KREN did not replace it.'");
    expect(source).toContain("'KREN has no result to copy yet.'");
    expect(source).toContain("'Choose at least one grammar correction first.'");
  });
});
