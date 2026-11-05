import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  window: { showWarningMessage: vi.fn(), showErrorMessage: vi.fn(async () => undefined) },
  env: { remoteName: undefined },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chirpFailureMessage } from '../src/googleChirpSpeech.js';
import { SpeechCenter } from '../src/speech/speechCenter.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

/**
 * F7 (plan rows V5 and V7): a second press of Read Aloud stops it, another KREN action or a screen change stops it, and a Google Chirp
 * 401 or 403 says what to check. Verify results: these read the calls the code makes. Whether the voice actually falls silent when a
 * person presses twice needs someone running VS Code on Windows with speakers.
 */

afterEach(() => { vi.restoreAllMocks(); });

describe('V7: Google Chirp refusals', () => {
  it('401 says to check the key in KREN menu, Credentials', () => {
    expect(chirpFailureMessage(401)).toBe('Google Cloud Text-to-Speech failed (HTTP 401). Google refused the speech request: check the Google Cloud key in KREN menu, Credentials.');
  });
  it('403 says the Text-to-Speech API may need turning on, or the key may not allow it', () => {
    expect(chirpFailureMessage(403)).toBe('Google Cloud Text-to-Speech failed (HTTP 403). Google refused the speech request. The Google Cloud project for this key may need the Text-to-Speech API turned on, or the key may not allow it.');
  });
  it('keeps the Google status codes in the 403 text and adds no advice to other statuses', () => {
    expect(chirpFailureMessage(403, 'x', 'PERMISSION_DENIED SERVICE_DISABLED')).toContain('(HTTP 403 PERMISSION_DENIED SERVICE_DISABLED).');
    expect(chirpFailureMessage(429)).toBe('Google Cloud Text-to-Speech failed (HTTP 429).');
    expect(chirpFailureMessage(undefined, 'no response')).toBe('Google Cloud Text-to-Speech failed (no response).');
  });
});

describe('V5: the speech center knows when Read Aloud is reading', () => {
  function center() {
    let finish: () => void = () => undefined;
    const windows = { speak: vi.fn(() => new Promise(resolve => { finish = () => resolve({ status: 'completed' }); })),
      stop: vi.fn(() => { finish(); return true; }) };
    const idle = { stop: vi.fn(() => false), speak: vi.fn(), cancellationGeneration: () => 0, playbackStarted: vi.fn(), beginConversation: vi.fn(() => false) };
    const host = { configuration: () => ({ get: (key: string, fallback: unknown) => key.endsWith('readAloud.provider') ? 'windowsLocal' : fallback }),
      trusted: () => true, consent: async () => true, active: vi.fn(async () => undefined), status: () => ({ dispose: vi.fn() }), hold: () => vi.fn(),
      started: vi.fn(), liveSpeaking: () => false, conversation: () => undefined, speakerVoice: () => '', playback: () => undefined, notify: vi.fn(), log: vi.fn() };
    const speech = new SpeechCenter(idle as never, idle as never, { stop: vi.fn(() => false), speak: vi.fn() } as never, windows as never, host as never);
    return { speech, windows, finish: () => finish() };
  }
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

  it('is reading while a shared reading plays, and not before, after stop, or after it ends', async () => {
    const { speech, finish } = center();
    expect(speech.sharedSpeaking()).toBe(false);
    const reading = speech.speak('Hello there.');
    await flush();
    expect(speech.sharedSpeaking()).toBe(true);
    expect(speech.stop()).toBe(true);
    expect(speech.sharedSpeaking()).toBe(false);
    await reading;
    const second = speech.speak('Again.');
    await flush();
    expect(speech.sharedSpeaking()).toBe(true);
    finish();
    await second;
    expect(speech.sharedSpeaking()).toBe(false);
  });

  it('does not count tutor speech as Read Aloud', async () => {
    const { speech, finish } = center();
    const reading = speech.speak('Tutor line.', undefined, 'tutor');
    await flush();
    expect(speech.sharedSpeaking()).toBe(false);
    finish();
    await reading;
  });
});

describe('V5: the second press, another action and a screen change stop Read Aloud', () => {
  function setup(readingAloud: boolean) {
    const settings = { ...PANEL_SETTINGS_FIXTURE };
    const actions = { settings: () => settings, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(), readingAloud: vi.fn(() => readingAloud),
      readAloudText: vi.fn(async () => undefined), runCommand: vi.fn(async () => undefined),
      refreshReadAloudVoices: vi.fn(async () => undefined) };
    const view = new KrenResultsViewProvider(actions as never, {} as never);
    view.view = { visible: true, webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
      postMessage: vi.fn(async () => true) } } as never;
    const internals = view as unknown as { handleMessage(message: unknown): Promise<void>; userDictionaryState: { entries: unknown[] } };
    internals.userDictionaryState = { ...internals.userDictionaryState, entries: [{ id: 'one', term: 'lucid', language: 'en' }] };
    return { actions, send: (message: Record<string, unknown>) => internals.handleMessage(message) };
  }

  it('second press: a read icon pressed while reading stops it and starts nothing', async () => {
    const { actions, send } = setup(true);
    await send({ command: 'readUserDictionaryEntry', entryId: 'one' });
    expect(actions.stopReadAloud).toHaveBeenCalledOnce();
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('first press: the same icon reads when nothing is reading', async () => {
    const { actions, send } = setup(false);
    await send({ command: 'readUserDictionaryEntry', entryId: 'one' });
    expect(actions.readAloudText).toHaveBeenCalledWith('lucid', 'en');
    expect(actions.stopReadAloud).not.toHaveBeenCalled();
  });

  it('second press of the Read Aloud command is decided by the command, so the panel does not stop it first', async () => {
    const { actions, send } = setup(true);
    await send({ command: 'runCommand', action: 'kren.readAloudSelection' });
    expect(actions.runCommand).toHaveBeenCalledWith('kren.readAloudSelection');
    expect(actions.stopReadAloud).not.toHaveBeenCalled();
  });

  it('another KREN action stops a reading before it runs', async () => {
    const { actions, send } = setup(true);
    await send({ command: 'runCommand', action: 'kren.translateSelection' });
    expect(actions.stopReadAloud).toHaveBeenCalledOnce();
    expect(actions.runCommand).toHaveBeenCalledWith('kren.translateSelection');
  });

  it('another KREN action leaves speech alone when nothing is reading', async () => {
    const { actions, send } = setup(false);
    await send({ command: 'runCommand', action: 'kren.translateSelection' });
    expect(actions.stopReadAloud).not.toHaveBeenCalled();
  });

  it.each(['showStartPage', 'showSettings', 'showTutor', 'showUserDictionary'])('a screen change (%s) stops a reading', async command => {
    const { actions, send } = setup(true);
    await send({ command });
    expect(actions.stopReadAloud).toHaveBeenCalled();
  });

  it('the extension routes the second press and the editor actions through the one stop path', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
    const read = source.slice(source.indexOf('async function executeReadAloudSelection('));
    expect(read.slice(0, read.indexOf('process.platform'))).toMatch(/speechCenter\.sharedSpeaking\(\)[\s\S]*stopReadAloud\(true\)[\s\S]*return;/u);
    expect(source).toContain('readingAloud: () => speechCenter.sharedSpeaking()');
    for (const name of ['executeLookup', 'executeGrammarCheck', 'executeClipboardLookup', 'executeAddToUserDictionary']) {
      const body = source.slice(source.indexOf(`async function ${name}(`));
      expect(body.slice(0, body.indexOf('{\n', body.indexOf('): Promise<void>')) + 400), name).toContain('stopSharedReadAloud();');
    }
  });
});
