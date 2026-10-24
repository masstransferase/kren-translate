import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { speakTutorConversationSequence } from '../src/resultsViewReplay.js';
import type { KrenResultsViewProvider } from '../src/resultsView.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { TUTOR_LESSON_UNAVAILABLE } from '../src/tutor/lessonConversation.js';
import { speechSsml } from '../src/speech/sentencePause.js';
import { WindowsEdgeReadAloudTransport } from '../src/windowsEdgeReadAloud.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from '../src/speech/windowsSpeechAdapters.js';
import { GoogleChirpSpeech, SpeechCenter, type SpeechHost } from '../src/speech/speechCenter.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function panel(tutor = createTutorViewState()) {
  return mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
    settings: PANEL_SETTINGS_FIXTURE, tutor, proModels: [] }), vi.fn());
}

it('R1 shows lesson completion only for the lesson source and updates the reachable Source row in place', () => {
  for (const from of ['situation', 'anything', 'speakAndRephrase', 'lesson'] as const) {
    const tutor = createTutorViewState();
    tutor.conversation.from = from;
    const mounted = panel(tutor);
    const source = mounted.query('[data-tutor-conversation-from]')!;
    const description = source.closest('label')!.querySelector('.setting-description')!;
    expect(description.textContent).toBe(from === 'lesson' ? TUTOR_LESSON_UNAVAILABLE : 'Where the conversation takes its subject.');
    const setting = mounted.query('[data-tutor-open-conversation-settings]')!;
    expect(setting.closest('details, [hidden]')).toBeNull();
    expect(setting.disabled).toBe(false);
    expect(setting.getAttribute('tabindex')).not.toBe('-1');
    mounted.click(setting);
    expect(source.closest('details')!.open).toBe(true);
    expect(source.disabled).toBe(false);
    source.focus();
    expect(mounted.document.activeElement).toBe(source);
    for (const value of ['lesson', 'situation', 'anything']) {
      source.value = value;
      mounted.change(source);
      expect(description.textContent).toBe(value === 'lesson' ? TUTOR_LESSON_UNAVAILABLE : 'Where the conversation takes its subject.');
      expect(mounted.query('[data-tutor-conversation-from]')).toBe(source);
    }
    if (from === 'lesson') {
      for (const command of ['startTutorConversation', 'startTutorConversationDemo']) {
        const button = mounted.query(`[data-command="${command}"]`)!;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe(TUTOR_LESSON_UNAVAILABLE);
      }
    }
  }
});

it('R2 arms the old speech deadline plus nine pauses for ten sentences and keeps the ceiling', async () => {
  vi.useFakeTimers();
  for (const [text, pause, expected] of [
    ['This is a sentence. '.repeat(10).trim(), 1000, 129_000],
    ['This is a sentence. '.repeat(10).trim(), 0, 120_000],
    ['A sentence with a long reading. '.repeat(200).trim(), 1000, 600_000]
  ] as const) {
    let finish!: () => void;
    const view = { tutorState: createTutorViewState(), tutorReplayAllGeneration: 0,
      postTutorConversationStopState: vi.fn(), render: vi.fn(), actions: {
        settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorSentencePauseMilliseconds: pause }),
        readAloudText: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), stopReadAloud: vi.fn()
      }
    } as unknown as KrenResultsViewProvider;
    const timer = vi.spyOn(globalThis, 'setTimeout');
    speakTutorConversationSequence(view, [text], 'Speech failed.');
    view.tutorConversationSpeechStarted!();
    const old = Math.max(120_000, text.length * 180 + 30_000);
    expect(timer.mock.calls.at(-1)![1]).toBe(expected);
    if (pause === 1000 && expected !== 600_000) expect(expected).toBe(old + 9_000);
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(view.actions.stopReadAloud).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.actions.stopReadAloud).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    timer.mockRestore();
  }
});

it('R3 passes only unspoken Edge sentences through the adapter, locale retry and Local Windows fallback', async () => {
  vi.useFakeTimers();
  const text = 'First sentence. Second sentence. Third sentence.';
  const suffix = 'Second sentence. Third sentence.';
  for (const scenario of ['playback', 'synthesis', 'throw', 'localeRetry', 'beforeFirst', 'zeroPause'] as const) {
    let clip = 0;
    const transport = new WindowsEdgeReadAloudTransport('win32', (_command, _args, options) => {
      const child = new EventEmitter() as ChildProcess;
      const input = new PassThrough();
      Object.defineProperty(child, 'stdin', { value: input });
      child.kill = vi.fn(() => true);
      input.on('finish', () => queueMicrotask(() => child.emit('exit',
        scenario === 'synthesis' && options.env?.KREN_EDGE_AUDIO_FILE?.includes('clip-2.') ? 1 : 0)));
      return child;
    }, async () => ({ directory: 'temporary', file: `clip-${++clip}.mp3` }), async () => {}, async () => true);
    const playback = { play: vi.fn(async (file: string) => {
      if (scenario === 'throw' && file === 'clip-2.mp3') throw new Error('Playback failed.');
      return file === (scenario === 'beforeFirst' || scenario === 'zeroPause' ? 'clip-1.mp3' : 'clip-2.mp3') ||
        scenario === 'localeRetry' && file !== 'clip-1.mp3' ? 'failed' as const : 'completed' as const;
    }), stop: () => false };
    const edge = new EdgeOnlineSpeechAdapter(transport);
    const edgeSpeak = vi.spyOn(edge, 'speak');
    const localSpeak = vi.fn(async (_text: string) => true);
    const values: Record<string, unknown> = { 'tutor.readAloud.provider': 'edgeOnline',
      'tutor.readAloud.edgeLocale': scenario === 'localeRetry' ? 'ko-KR' : 'en-US',
      'tutor.readAloud.sentencePauseMilliseconds': scenario === 'zeroPause' ? 0 : 500 };
    const chirp = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, vi.fn());
    const host: SpeechHost = { configuration: () => ({ get: ((key: string, fallback: unknown) => values[key] ?? fallback) as never }),
      trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
      hold: () => () => {}, started() {}, liveSpeaking: () => false, conversation: () => ({}),
      speakerVoice: () => '', playback: () => playback, notify: vi.fn(), log: vi.fn() };
    const center = new SpeechCenter(chirp, chirp, edge, new LocalWindowsSpeechAdapter({ speak: localSpeak, stop: () => false }), host);
    const pending = center.speak(text, 'en', 'tutor');
    await vi.runAllTimersAsync();
    await pending;
    expect(localSpeak.mock.calls.map(call => call[0])).toEqual([
      scenario === 'beforeFirst' || scenario === 'zeroPause' ? text : suffix
    ]);
    expect(edgeSpeak.mock.calls.map(call => call[0])).toEqual(scenario === 'localeRetry' ? [text, suffix] : [text]);
    if (scenario === 'zeroPause') expect(clip).toBe(1);
  }
});

it('R4 strips forbidden XML characters before escaping while retaining valid whitespace boundaries and surrogate pairs', () => {
  const clean = speechSsml('Hello there. Next.', 500);
  expect(speechSsml('Hello\u0001 there. Next.', 500)).toBe(clean);
  expect(speechSsml('Hello\u0001 there. Next.', 500).includes('\u0001')).toBe(false);
  const forbidden = Array.from({ length: 32 }, (_, code) => code).filter(code => ![9, 10, 13].includes(code))
    .map(code => String.fromCharCode(code)).join('') + '\uFFFE\uFFFF\uD800x\uDC00';
  expect(speechSsml('Hel' + forbidden + 'lo there. Next.', 500)).toBe(speechSsml('Helxlo there. Next.', 500));
  expect(speechSsml('Hello\tthere\nnext\rline & <tag> "yes" \'ok\' 😀.', 500)).toBe(
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">Hello\tthere<break time="500ms"/>next<break time="500ms"/>line &amp; &lt;tag&gt; &quot;yes&quot; &apos;ok&apos; 😀.</speak>');
});

it('R5 updates the reachable Sentence pause description on active Coach Replies changes without replacing the composer', () => {
  const tutor = createTutorViewState();
  Object.assign(tutor.conversation, { from: 'speakAndRephrase', status: 'active', replies: 'standard' });
  const mounted = panel(tutor);
  const composer = mounted.query('[data-tutor-composer]')!;
  const replies = mounted.query('[data-tutor-conversation-replies]')!;
  const pause = mounted.query('[data-setting="tutor.readAloud.sentencePauseMilliseconds"]')!;
  const description = pause.closest('label')!.querySelector('.setting-description')!;
  expect(description.textContent).toBe('Pause between sentences in tutor speech.');
  expect(pause.closest('[hidden], .conditional-group, [data-tutor-voice-group]')).toBeNull();
  expect(pause.disabled).toBe(false);
  expect(pause.getAttribute('tabindex')).not.toBe('-1');
  for (let disclosure = pause.closest('details'); disclosure; disclosure = disclosure.parentElement!.closest('details')) {
    const summary = disclosure.querySelector('summary')!;
    summary.focus();
    expect(mounted.document.activeElement).toBe(summary);
    disclosure.open = true;
  }
  pause.focus();
  expect(mounted.document.activeElement).toBe(pause);
  expect(replies.disabled).toBe(false);
  for (const value of ['liveGemini', 'standard', 'liveGemini']) {
    replies.value = value;
    mounted.change(replies);
    expect(description.textContent).toBe(value === 'liveGemini' ? 'Gemini Live sets its own pauses.' : 'Pause between sentences in tutor speech.');
    expect(mounted.query('[data-tutor-composer]')).toBe(composer);
    expect(mounted.query('[data-setting="tutor.readAloud.sentencePauseMilliseconds"]')).toBe(pause);
  }
});
