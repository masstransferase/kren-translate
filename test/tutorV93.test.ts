// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { hostSource } from './support/hostSource.js';
import { TUTOR_MAP } from '@kren/core/tutor';

const configuredSpeechProvider = vi.hoisted(() => ({ value: 'auto' }));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) =>
        key === 'tutor.speechProvider' ? configuredSpeechProvider.value : fallback
    })
  },
  Uri: { joinPath: (...parts: unknown[]) => parts }
}));

import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import {
  KrenResultsViewProvider,
  findHandyExecutable,
  toggleHandyTranscription
} from '../src/resultsView.js';
import { createTutorViewState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function practiceState(): TutorViewState {
  const state = createTutorViewState();
  state.exerciseSet = {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    channel: 'written',
    exercises: [{
      id: 'practice-1',
      channel: 'written',
      prompt: 'Tell me what you did yesterday.',
      targetIds: [TUTOR_MAP[0]!.id]
    }]
  };
  return state;
}

function microphone(state: TutorViewState, provider: 'auto' | 'handy' | 'gemini' | 'off') {
  return load(renderTutorExercises(state, provider))(
    'button[data-command="dictateTutorExercise"]'
  );
}

function providerWithHandy(toggle: (executable: string) => Promise<void>) {
  const actions = {
    notify: vi.fn(),
    log: vi.fn(),
    settings: vi.fn(() => ({
      tutorProvider: 'gemini',
      tutorModel: 'gemini-3.6-flash',
      tutorThinkingOrEffort: 'medium'
    }))
  };
  const provider = new KrenResultsViewProvider(actions as never, {} as never, {
    detect: vi.fn(async () => 'C:\\Tools\\Handy\\handy.exe'),
    toggle
  });
  const internals = provider as unknown as {
    tutorState: TutorViewState;
    handyExecutable?: string;
    handleMessage(message: unknown): Promise<void>;
  };
  internals.tutorState = practiceState();
  internals.tutorState.speech.handyStatus = 'available';
  internals.handyExecutable = 'C:\\Tools\\Handy\\handy.exe';
  return { internals, actions };
}

describe('V93 Handy practice microphone', () => {
  it('R1 declares every speech provider, defaults to auto, and reports a missing Gemini key', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, {
        type: string;
        enum: string[];
        default: string;
      }> } };
    };
    // 2026-10-10: Cloudflare joins the supported dictation routes; Auto stays the default.
    expect(manifest.contributes.configuration.properties['kren.tutor.speechProvider'])
      // 2026-10-11: V219 adds Groq dictation while retaining the Auto default.
      .toMatchObject({ type: 'string', enum: ['auto', 'handy', 'groq', 'gemini', 'cloudflare', 'off'], default: 'auto' });

    const state = practiceState();
    state.speech.handyStatus = 'available';
    const button = microphone(state, 'gemini');
    expect(button.is('[disabled]')).toBe(true);
    expect(button.attr('title')).toMatch(/Gemini Free Tier API key/iu);
  });

  it('R2 finds handy.exe on PATH without assuming a user directory', async () => {
    const checked: string[] = [];
    const found = await findHandyExecutable({
      platform: 'win32',
      environment: {
        PATH: 'C:\\Windows\\System32;C:\\Tools\\Handy',
        LOCALAPPDATA: 'C:\\Profiles\\reader\\AppData\\Local'
      },
      isFile: async (candidate) => {
        checked.push(candidate);
        return candidate === 'C:\\Tools\\Handy\\handy.exe';
      }
    });
    expect(found).toBe('C:\\Tools\\Handy\\handy.exe');
    expect(checked).toContain('C:\\Tools\\Handy\\handy.exe');
    // Detection must derive every path from the environment. Asserting the absence of an
    // absolute user path keeps this guard from carrying the identifier it exists to forbid.
    expect(hostSource()).not.toMatch(/C:\\Users\\/i);
  });

  it('R2 finds the Local AppData installation and returns unavailable when neither location exists', async () => {
    const local = 'D:\\ReaderData\\Local\\Handy\\handy.exe';
    await expect(findHandyExecutable({
      platform: 'win32',
      environment: { PATH: 'C:\\Bin', LOCALAPPDATA: 'D:\\ReaderData\\Local' },
      isFile: async (candidate) => candidate === local
    })).resolves.toBe(local);
    await expect(findHandyExecutable({
      platform: 'win32',
      environment: { PATH: 'C:\\Bin', LOCALAPPDATA: 'D:\\ReaderData\\Local' },
      isFile: async () => false
    })).resolves.toBeUndefined();
  });

  it.each([
    ['C:\\Tools\\Handy\\handy.exe', 'available', false],
    [undefined, 'notFound', true]
  ] as const)('R2 R3 carries detection result %s into view state and button availability', async (
    executable, expectedStatus, disabled
  ) => {
    const actions = {
      notify: vi.fn(),
      log: vi.fn(),
      settings: vi.fn(() => ({
        tutorProvider: 'gemini', tutorModel: 'gemini-3.6-flash', tutorThinkingOrEffort: 'medium'
      }))
    };
    const provider = new KrenResultsViewProvider(actions as never, {} as never, {
      detect: vi.fn(async () => executable),
      toggle: vi.fn()
    });
    const internals = provider as unknown as {
      tutorState: TutorViewState;
      refreshTutorSpeechAvailability(): Promise<void>;
    };
    internals.tutorState = practiceState();
    await internals.refreshTutorSpeechAvailability();
    expect(internals.tutorState.speech.handyStatus).toBe(expectedStatus);
    expect(microphone(internals.tutorState, 'auto').is('[disabled]')).toBe(disabled);
  });

  it('R3 keeps the microphone rendered and makes its enabled state follow Handy availability', () => {
    const state = practiceState();
    state.speech.handyStatus = 'notFound';
    const absent = microphone(state, 'auto');
    expect(absent).toHaveLength(1);
    expect(absent.is('[disabled]')).toBe(true);
    expect(absent.attr('title')).toMatch(/Handy was not found/iu);

    state.speech.handyStatus = 'available';
    const present = microphone(state, 'auto');
    expect(present).toHaveLength(1);
    expect(present.is('[disabled]')).toBe(false);
    expect(microphone(state, 'handy').is('[disabled]')).toBe(false);

    const off = microphone(state, 'off');
    expect(off.is('[disabled]')).toBe(true);
    expect(off.attr('title')).toMatch(/turned off in Settings/iu);
  });

  it('R4 focuses that exercise answer box before posting the dictation command', () => {
    const output = renderKrenResultViewHtml({
      cspSource: 'test',
      nonce: 'test',
      settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor',
      tutor: practiceState(),
      tutorSpeechProvider: 'auto',
      proModels: []
    });
    const focusStart = output.indexOf("if (command === 'dictateTutorExercise') {");
    const focusCall = output.indexOf('answer.focus();', focusStart);
    const post = output.indexOf('if (command) vscode.postMessage({', focusStart);
    expect(focusStart).toBeGreaterThan(-1);
    // Changed 2026-09-30: V175 moves the microphone outside the inner card into its practice panel.
    expect(output.slice(focusStart, focusCall)).toContain("target.closest('.tutor-practice-panel')");
    expect(focusCall).toBeGreaterThan(focusStart);
    expect(post).toBeGreaterThan(focusCall);
  });

  it('R5 toggles KREN own running belief and exposes the stop state on the same button', async () => {
    const toggle = vi.fn(async () => undefined);
    const { internals } = providerWithHandy(toggle);

    await internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(toggle).toHaveBeenLastCalledWith('C:\\Tools\\Handy\\handy.exe');
    expect(internals.tutorState.speech.dictatingExerciseId).toBe('practice-1');
    const running = microphone(internals.tutorState, 'auto');
    expect(running.attr('aria-pressed')).toBe('true');
    // 2026-10-10: the owner wants Pause while Handy listens; check the action and route.
    expect(running.attr('title')).toMatch(/pause.*Handy.*dictation/iu);

    await internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(internals.tutorState.speech.dictatingExerciseId).toBeUndefined();
  });

  it('R6 spawns only Handy with the one toggle flag and no audio payload', async () => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    const child = {
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners[event] = listener;
        return child;
      }),
      unref: vi.fn()
    };
    const spawnProcess = vi.fn(() => child);
    const pending = toggleHandyTranscription(
      'C:\\Tools\\Handy\\handy.exe',
      spawnProcess as never
    );
    listeners.spawn!();
    await pending;
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Tools\\Handy\\handy.exe',
      ['--toggle-transcription'],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
  });

  it('R7 names Handy when its process cannot start and leaves the running belief unchanged', async () => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    const child = {
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners[event] = listener;
        return child;
      }),
      unref: vi.fn()
    };
    const pending = toggleHandyTranscription(
      'C:\\Tools\\Handy\\handy.exe',
      vi.fn(() => child) as never
    );
    listeners.error!(new Error('process creation failed'));
    await expect(pending).rejects.toThrow('process creation failed');

    const { internals, actions } = providerWithHandy(async () => {
      throw new Error('process creation failed');
    });
    await internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(actions.notify).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/Handy.+could not start/iu)
    );
    expect(actions.log).toHaveBeenCalledWith(expect.stringMatching(/Handy/iu));
    expect(internals.tutorState.speech.dictatingExerciseId).toBeUndefined();
  });
});
