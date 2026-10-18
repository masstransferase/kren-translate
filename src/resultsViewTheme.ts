import * as vscode from 'vscode';
import { effectivePanelTheme, type PanelTheme, type PanelThemeKind } from './panelThemes.js';

const panels = new Map<vscode.Webview, () => PanelTheme>();

export function currentPanelThemeKind(): PanelThemeKind {
  const kind = vscode.window.activeColorTheme?.kind;
  // ColorThemeKind.Light = 1, HighContrastLight = 4. HighContrast uses the dark logo.
  return kind === 1 || kind === 4 || kind === undefined ? 'light' : 'dark';
}

export function broadcastPanelTheme(theme?: PanelTheme): void {
  for (const [webview, readTheme] of panels) {
    void webview.postMessage({ command: 'panelThemeChanged', theme: theme ?? readTheme(), kind: currentPanelThemeKind() });
  }
}

export function registerPanelTheme(webview: vscode.Webview, readTheme: () => PanelTheme): vscode.Disposable {
  panels.set(webview, readTheme);
  const configuration = vscode.workspace.onDidChangeConfiguration?.(event => {
    if (event.affectsConfiguration('kren.display.panelTheme')) broadcastPanelTheme();
  });
  const appearance = vscode.window.onDidChangeActiveColorTheme?.(() => broadcastPanelTheme());
  return { dispose() { panels.delete(webview); configuration?.dispose(); appearance?.dispose(); } };
}

export function shownPanelTheme(theme: PanelTheme): PanelThemeKind {
  return effectivePanelTheme(theme, currentPanelThemeKind());
}
