import { describe, expect, it, vi } from 'vitest';

const executeCommand = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('vscode', () => ({
  commands: { executeCommand },
  env: { remoteName: undefined },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  window: {},
  // 2026-09-18: V114 reads the reader-owned model lists when a panel provider is created.
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';

/*
 * Ignore all, added 1.7.12 at the owner's request on 2026-08-29. This file covers what
 * pressing it does; the two assertions about how it renders live beside the other grammar
 * markup assertions in resultViewHtml.test.ts.
 *
 * The behaviour breaks silently rather than loudly. actions.clear() ends by calling this
 * view's own clear(), which sets the screen back to 'result'. Setting the start screen
 * before that call rather than after renders an empty result screen instead, which looks
 * like a button that half worked and reports no error anywhere.
 */

function provider(): {
  clear: ReturnType<typeof vi.fn>;
  handleMessage(message: unknown): Promise<void>;
  screen(): string;
} {
  /*
   * The stub has to end in the view's own clear(), because that is what the extension
   * wires it to: extension.ts's clear drops lastResult, the hover, and the code actions,
   * and then calls resultsView.clear(), which sets the screen back to 'result'. A bare
   * vi.fn() here makes the ordering unobservable, and the first version of this file used
   * one: the mutation putting the start screen before the clear survived the whole suite.
   */
  const clear = vi.fn(() => { view.clear(); });
  const view = new KrenResultsViewProvider(
    // Changed 2026-10-16: V247, owner item I24, navigation stops Read Aloud through the actions.
    { clear, log: vi.fn(), stopReadAloud: vi.fn(), settings: vi.fn(() => ({ openResultsAtStartup: true })) } as never,
    {} as never
  );
  const internals = view as unknown as {
    handleMessage(message: unknown): Promise<void>;
    activeScreen: string;
  };
  return {
    clear,
    handleMessage: (message: unknown) => internals.handleMessage(message),
    screen: () => internals.activeScreen
  };
}

describe('Ignore all on a grammar result', () => {
  it('drops the result and leaves the panel on the Start page', async () => {
    const view = provider();

    await view.handleMessage({ command: 'ignoreGrammarResult' });

    expect(view.clear, 'the stored result, the hover, and the code actions are dropped')
      .toHaveBeenCalledTimes(1);
    expect(view.screen(), 'the screen set after clear(), which itself sets result')
      .toBe('start');
  });

  it('is what the guard accepted, rather than the handler running for anything', async () => {
    const view = provider();

    /*
     * A command absent from the inbound guard is dropped without an error, which is how a
     * normal-looking button comes to do nothing. Sending a name that is genuinely absent
     * is what makes the assertion above evidence rather than coincidence.
     */
    await view.handleMessage({ command: 'ignoreEveryGrammarResultTwice' });

    expect(view.clear).not.toHaveBeenCalled();
    expect(view.screen()).not.toBe('start');
  });
});
