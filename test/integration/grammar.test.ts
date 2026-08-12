import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

declare function suite(name: string, callback: () => void): void;
declare function test(name: string, callback: () => Promise<void>): void;

// The extension identity is publisher-dependent: "local" when sideloaded from the
// private tree, "masstransferase" in the produced public tree. Looking it up by a
// hard-coded identifier passes in one channel and fails in the other, which is how a
// publisher change first showed up as "extension was not discovered".
function findKrenExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.all.find((candidate) => candidate.id.endsWith('.kren-translate'));
}

suite('KREN native Grammar Check', () => {
  test('publishes diagnostics, offers Quick Fixes, applies one, and rechecks', async () => {
    const extension = findKrenExtension();
    assert.ok(extension, 'KREN extension was not discovered by the Extension Development Host.');
    await extension.activate();
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'I has an apple.'
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(document.positionAt(0), document.positionAt(document.getText().length));

    await vscode.commands.executeCommand('kren.grammarCheckSelection');
    const diagnostics = await waitForDiagnostics(document.uri, (items) => items.length > 0);
    const agreement = diagnostics.find((diagnostic) => document.getText(diagnostic.range) === 'has');
    assert.ok(agreement, 'Expected Harper to underline “has”.');

    const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      agreement.range,
      vscode.CodeActionKind.QuickFix.value
    );
    const replacement = actions?.find((action): action is vscode.CodeAction =>
      action instanceof vscode.CodeAction && /Replace with.*have/iu.test(action.title)
    );
    assert.ok(replacement?.command, 'Expected a KREN replacement Quick Fix.');
    await vscode.commands.executeCommand(
      replacement.command.command,
      ...(replacement.command.arguments ?? [])
    );
    assert.equal(document.getText(), 'I have an apple.');
    await waitForDiagnostics(document.uri, (items) =>
      !items.some((diagnostic) => document.getText(diagnostic.range) === 'has')
    );
  });

  test('rejects a stale Quick Fix after the checked text changes', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'I has an apple.'
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(document.positionAt(0), document.positionAt(document.getText().length));
    await vscode.commands.executeCommand('kren.grammarCheckSelection');
    const diagnostics = await waitForDiagnostics(document.uri, (items) => items.length > 0);
    const diagnostic = diagnostics.find((item) => document.getText(item.range) === 'has');
    assert.ok(diagnostic);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider', document.uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value
    );
    const replacement = actions?.find((action) => /Replace with.*have/iu.test(action.title));
    assert.ok(replacement?.command);
    await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), 'Actually, '));
    await vscode.commands.executeCommand(
      replacement.command.command,
      ...(replacement.command.arguments ?? [])
    );
    assert.equal(document.getText(), 'Actually, I has an apple.');
  });
});

async function waitForDiagnostics(
  uri: vscode.Uri,
  predicate: (diagnostics: readonly vscode.Diagnostic[]) => boolean
): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri).filter((item) => item.source === 'KREN · Harper');
    if (predicate(diagnostics)) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for KREN grammar diagnostics.');
}
