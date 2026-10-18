import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorConversationPreferences, tutorConversationPreferencesOf } from '../src/tutor/state.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { listGroqModels } from '../src/providers/openAICompatible.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
const properties = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
const render = (tutor = createTutorViewState(), overrides = {}) => renderKrenResultViewHtml({
  cspSource: 'test', nonce: 'test', activeScreen: 'tutor', tutor, proModels: [],
  settings: { ...PANEL_SETTINGS_FIXTURE, ...overrides }
});
const press = 'Press the microphone once to start a Live turn and again to finish it, from the next conversation.';
// Changed 2026-10-17: V261, F5 owner canvas edit, test the timeout scope and exceptions rather than its wording.
const timeout = /How long KREN waits for a provider.*Cloudflare pictures wait at least 60 seconds.*Google Cloud speech (?:ignores|is not limited)/u;
const switching = 'When provider switching is on, a used-up daily or monthly free limit can send the same submitted text to the next provider with stored credentials, until local midnight. Live, pictures and dictation keep their selected provider.';
const live = "Live needs the selected Gemini profile's key and a live-capable Live Model in VOICE & MODEL; the tutor text Provider can stay as it is.";
const strong = 'For stronger replies, leave Fast model empty in LLM ROUTING; every fast step then uses the Thorough model.';

describe('V228 reader wording', () => {
  it.each([press, timeout, switching, live, strong,
    'Answers and reviews remain between items. Review all completes practice; errors include unnatural phrasing.'
  ])('keeps both manuals in agreement: %s', wording => {
    const manual = load(render())('#manual-screen').text().replace(/\s+/gu, ' ');
    if (wording === switching) {
      // 2026-10-14: V233 adds overload switching; compare both manuals' meaning rather than pinning a paragraph.
      for (const text of [guide, manual]) {
        expect(text).toMatch(/provider switching is on[\s\S]*daily or monthly[\s\S]*same submitted text[\s\S]*next provider with stored credentials[\s\S]*local midnight/u);
        expect(text).toMatch(/Live, pictures and dictation keep their selected provider/u);
        expect(text).toMatch(/Gemini overload after automatic retries[\s\S]*that request/u);
        expect(text).toMatch(/does not exhaust the Gemini pool until midnight/u);
      }
    } else if (wording === timeout) {
      // Changed 2026-10-17: V261, F5 owner canvas edit, both manuals retain the timeout exceptions.
      expect(guide).toMatch(timeout); expect(manual).toMatch(timeout);
    } else {
      expect(guide).toContain(wording); expect(manual).toContain(wording);
    }
  });
  it('shows Press to talk and the timeout scope in their controls and manifest', () => {
    const $ = load(render());
    expect($('[data-setting="tutor.conversation.pressToTalk"]').closest('.setting').find('.setting-description').text()).toBe(press);
    expect(properties['kren.tutor.conversation.pressToTalk'].description).toBe(press);
    // Changed 2026-10-17: V261, F5 owner canvas edit, the shorter timeout copy retains the same scope.
    expect(properties['kren.request.timeoutMs'].description).toMatch(timeout);
    expect($('[data-setting="request.timeoutMs"]').closest('.setting').find('.setting-description').text()).toMatch(timeout);
  });
  it('states switching and separates temporary retry from provider switching', () => {
    const $ = load(render(createTutorViewState(), { explanationProvider: 'openai' }));
    expect($('[data-setting="languageModel.retry.enabled"]').first().closest('.setting').find('.setting-description').text())
      .toBe('Retry temporary failures with the current provider. Provider switching is set separately under Usage.');
    for (const text of [guide, $('#manual-screen').text(), JSON.stringify(properties), $('.setting-description').text()]) {
      expect(text).not.toMatch(/never silently.*(?:provider|company)|never (?:changes|falls back).*provider/iu);
    }
  });
  it('names Fast steps, Chirp volume and the feature-specific model keys', () => {
    expect(properties['kren.tutor.hintModel'].description).toBe('Model used for Fast tutor steps, including hints, conversation replies and Ask. Leave empty to use the Thorough model.');
    expect(properties['kren.tutor.readAloud.volume'].description).toBe('Tutor playback volume for Local Windows, Edge Online and Google Cloud Chirp 3 HD.');
    for (const feature of ['explanation', 'rewrite']) {
      expect(properties[`kren.${feature}.geminiProfile`].enumDescriptions[0]).toContain(`kren.${feature}.model`);
      expect(properties[`kren.${feature}.geminiProfile`].enumDescriptions[1]).toContain(`kren.${feature}.alternateModel`);
    }
  });
  it('removes Reply thinking from MODE, ADVANCED, scripts and stored preferences', () => {
    const $ = load(render());
    expect($('#tutor-screen').text()).not.toContain('Reply thinking');
    expect($('script').text()).not.toContain('reply-thinking');
    expect(guide).not.toMatch(/reply thinking/iu); expect($('#manual-screen').text()).not.toMatch(/reply thinking/iu);
    expect(tutorConversationPreferences({ replyThinking: 'routing', replies: 'standard' })).toEqual({ replies: 'standard' });
    expect(tutorConversationPreferencesOf(createTutorViewState().conversation)).not.toHaveProperty('replyThinking');
  });
  it.each(['standard', 'liveGemini'] as const)('formats ADVANCED for %s and patches with the identical formatter', replies => {
    const tutor = createTutorViewState(); tutor.conversation.replies = replies;
    tutor.conversation.situationPicture = 'graduallyEntering'; tutor.conversation.pictureTransparency = '40'; tutor.conversation.balloonTransparency = '20';
    const html = render(tutor, { tutorConversationSpeechDetection: 'geminiKren', tutorConversationMicrophoneCloseWait: 4 });
    const $ = load(html); const summary = $('[data-tutor-conversation-advanced] > summary .rewrite-group-summary').text();
    expect(summary).toBe(`Reply: ${replies === 'standard' ? 'Standard | Send: When I stop speaking' : 'Live (Gemini)'} | Picture: Gradually Entering, Realistic, 40%, 20% | Microphone: Balanced, 2sec, Gemini + KREN, 4sec | Press to talk: Off | Live transcription language: English | Take-home card: On`);
    const script = $('script').text();
    const begin = script.indexOf('function tutorConversationAdvancedSummary(values)');
    const end = script.indexOf('\n    const activeScreen', begin);
    const formatter = script.slice(begin, script.indexOf('\n    }', begin) + 6);
    expect(end).toBeGreaterThan(begin);
    const patched = runInNewContext(`${formatter}; tutorConversationAdvancedSummary(values)`, { values: {
      replies: replies === 'standard' ? 'Standard' : 'Live (Gemini)', send: 'When I stop speaking', situationPicture: 'Gradually Entering',
      pictureStyle: 'Realistic', pictureTransparency: '40%', balloonTransparency: '20%', microphoneSensitivity: 'Balanced',
      pauseBeforeReply: '2 seconds', speechDetection: 'Gemini + KREN', microphoneCloseWait: '4 seconds',
      pressToTalk: 'Off', liveTranscriptionLanguage: 'English', takeHome: 'On'
    } });
    expect(patched).toBe(summary);
  });
  it('shows Picture: None alone and places Replies before the remaining settings', () => {
    const tutor = createTutorViewState(); tutor.conversation.situationPicture = 'none';
    const $ = load(render(tutor));
    const advanced = $('[data-tutor-conversation-advanced]');
    expect(advanced.children('summary').text()).toContain('| Picture: None | Microphone:');
    expect(advanced.find('.setting-title').slice(0, 2).map((_, element) => $(element).text()).get()).toEqual(['Replies', 'Live transcription language']); // Changed 2026-10-18: V263, owner item I43, Send was removed.
    const style = $('[data-setting="tutor.conversation.pictureStyle"]');
    expect(style.is(':disabled')).toBe(true); expect(style.attr('title')).toBe('Choose a Situation picture mode to enable Picture style');
    // Changed 2026-10-17: V262, owner item I39, exercise the picture-control patch instead of pinning its script syntax.
    const panel = mountedPanel(render(tutor), () => {});
    const pictureControl = panel.query('[data-tutor-conversation-situation-picture]')!;
    const styleControl = panel.query('[data-setting="tutor.conversation.pictureStyle"]')!;
    pictureControl.value = 'intro';
    panel.change(pictureControl);
    expect(styleControl.disabled).toBe(false);
    expect(styleControl.getAttribute('title')).toBeNull();
    pictureControl.value = 'none';
    panel.change(pictureControl);
    expect(styleControl.disabled).toBe(true);
    expect(styleControl.getAttribute('title')).toMatch(/Choose a Situation picture mode.*Picture style/u);
  });
  it('puts Speech provider in VOICE & MODEL with writable choices and no extra disclosure', () => {
    const $ = load(render()); const select = $('[data-setting="tutor.speechProvider"]');
    expect(select).toHaveLength(1); expect(select.closest('details').children('summary').text()).toContain('VOICE & MODEL');
    expect(select.closest('.setting').find('.setting-title').text()).toBe('Speech provider');
    expect(select.attr('tabindex')).toBeUndefined();
    expect(select.find('option').map((_, option) => $(option).text()).get()).toEqual(['Auto', 'Handy', 'Cloudflare', 'Groq', 'Gemini', 'Off']);
    for (const choice of properties['kren.tutor.speechProvider'].enum) expect(validatedPanelSetting('tutor.speechProvider', choice)).toBe(choice);
    expect(validatedPanelSetting('tutor.speechProvider', 'unknown')).toBeUndefined();
    expect($('#manual-screen').text()).not.toMatch(/speechProvider in VS Code Settings/u);
  });
  it('explains unavailable Demo and the opening, native playback and speech timing', () => {
    const tutor = createTutorViewState(); tutor.conversation.speakerOn = false; tutor.conversation.from = 'situation';
    expect(load(render(tutor))('[data-command="startTutorConversationDemo"]').attr('title')).toBe('Turn the speaker on to run Demo');
    tutor.conversation.speakerOn = true;
    expect(load(render(tutor, { credentialPresence: {} }))('[data-command="startTutorConversationDemo"]').attr('title')).toMatch(/Gemini.*key/u);
    const manual = load(render())('#manual-screen').text().replace(/\s+/gu, ' ');
    for (const paragraph of guide.split('\n').filter(line => line.startsWith('With Standard replies and the speaker on,') || line.startsWith('Chirp requests speech by sentence,'))) {
      // 2026-10-14: V232 changes speech guidance; check its meaning rather than copying a paragraph.
      if (paragraph.startsWith('Chirp requests')) {
        for (const text of [paragraph, manual]) {
          expect(text).toMatch(/Chirp requests speech by sentence[\s\S]*keeping their order/u);
          expect(text).toMatch(/retries synthesis once[\s\S]*400, 401, and 403/u);
          expect(text).toMatch(/Native playback failure[\s\S]*immediately[\s\S]*never re-synthesizes/u);
          expect(text).toMatch(/Local Windows reads[\s\S]*remaining text[\s\S]*tutor voice settings/u);
          expect(text).toMatch(/one speech notice[\s\S]*per conversation/u);
        }
      } else expect(manual).toContain(paragraph.trim());
    }
    expect(manual).toMatch(/hidden native Windows player[\s\S]*open or closed/u);
    expect(manual).toMatch(/temporary MP3[\s\S]*deleted after playback or Stop/u);
    for (const text of [guide, manual]) {
      expect(text).toContain('Cloudflare free models'); expect(text).toContain('Explanation language');
      expect(text).toContain('Auto chooses Handy, Cloudflare, Groq, then Gemini Free Tier.');
      // Changed 2026-10-17: V261, F5 owner canvas edit, provider-order buttons are icons.
      expect(text).toContain('Move up and Move down'); expect(text).toContain('Requests today');
    }
  });
  it('explains completed Review all and updates the tooltip when an answer changes', () => {
    const tutor = createTutorViewState();
    tutor.exerciseSet = { schemaVersion: 1, mapVersion: 'fixture', channel: 'written', exercises: [
      { id: 'first', channel: 'written', prompt: 'Give an answer.', targetIds: [] },
      { id: 'second', channel: 'written', prompt: 'Give another answer.', targetIds: [] }
    ] };
    tutor.currentExerciseIndex = tutor.exerciseSet!.exercises.length - 1;
    for (const exercise of tutor.exerciseSet!.exercises) {
      tutor.answers[exercise.id] = 'Current answer';
      tutor.reviews[exercise.id] = { schemaVersion: 1, exerciseId: exercise.id, learnerText: 'Current answer', correct: [], incorrect: [] };
    }
    const $ = load(render(tutor)); const review = $('[data-command="reviewUnreviewedTutorExercises"]');
    expect(review.is(':disabled')).toBe(true);
    expect(review.attr('title')).toBe('All current answers are reviewed. Edit an answer to enable Review all');
    const attributes = new Map<string, string>([['data-review-all', 'true'], ['data-first-unanswered-other', '-1'], ['data-pending-other', 'false'], ['data-reviewed-answer', 'Current answer']]);
    const panel = { getAttribute: (key: string) => key === 'data-item-number' ? '2' : key === 'data-item-reviewed' ? 'true' : 'false', querySelector: () => undefined };
    const control = { disabled: false, getAttribute: (key: string) => attributes.get(key), setAttribute: (key: string, value: string) => attributes.set(key, value), closest: () => panel };
    const script = $('script').text();
    const source = ['syncTutorReviewState', 'syncTutorReviewAvailability'].map(name => {
      const begin = script.indexOf(`function ${name}(`);
      return script.slice(begin, script.indexOf('\n    }', begin) + 6);
    }).join('\n');
    const context = { control, answer: 'Current answer' };
    runInNewContext(`${source}; syncTutorReviewAvailability(answer, control);`, context);
    expect(control.disabled).toBe(true); expect(attributes.get('title')).toBe(review.attr('title'));
    context.answer = 'Edited answer';
    runInNewContext(`${source}; syncTutorReviewAvailability(answer, control);`, context);
    expect(control.disabled).toBe(false); expect(attributes.get('title')).toMatch(/Review all/u);
  });
  it('patches the Speech provider microphone state while retaining the active answer', () => {
    const tutor = createTutorViewState();
    Object.assign(tutor.conversation, { status: 'active', replies: 'standard', draftAnswer: 'Unsent answer' });
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', tutor,
      tutorSpeechProvider: 'off', settings: PANEL_SETTINGS_FIXTURE, proModels: [] });
    const $ = load(html); const nextMicrophone = $('[data-command="dictateTutorConversation"]').first();
    expect(nextMicrophone.is(':disabled')).toBe(true);
    class Button {
      disabled = false; className = ''; title = ''; innerHTML = '';
      attrs = new Map<string, string>();
      getAttribute(key: string) { return this.attrs.get(key); }
      setAttribute(key: string, value: string) { this.attrs.set(key, value); }
    }
    const current = new Button(), next = new Button();
    next.disabled = nextMicrophone.is(':disabled'); next.title = nextMicrophone.attr('title')!;
    next.className = nextMicrophone.attr('class')!; next.innerHTML = nextMicrophone.html()!;
    for (const [key, value] of Object.entries(nextMicrophone.attr()!)) next.attrs.set(key, value);
    const section = { innerHTML: '', querySelectorAll: () => [] };
    const answer = { value: 'Unsent answer' };
    const script = $('script').text(); const begin = script.indexOf('function patchTutorVoiceModel(message)');
    const source = script.slice(begin, script.indexOf('\n    }', begin) + 6);
    const document = { querySelector: () => section,
      querySelectorAll: (selector: string) => selector.includes('dictateTutorConversation') ? [current] : [] };
    class Parser { parseFromString() { return { querySelector: (selector: string) => selector.startsWith('details') ? { innerHTML: 'Updated voice controls' } : selector.includes('dictateTutorConversation') ? next : null }; } }
    runInNewContext(`${source}; patchTutorVoiceModel(message);`, { message: { html, speechProviderChanged: true },
      document, DOMParser: Parser, HTMLButtonElement: Button, applyConditionalSettings: () => undefined });
    expect(current.disabled).toBe(true); expect(current.title).toBe(next.title);
    expect(current.getAttribute('data-tutor-dictation-route-unavailable')).toBe('true');
    expect(section.innerHTML).toBe('Updated voice controls'); expect(answer.value).toBe('Unsent answer');
  });
});

describe('V228 Groq chat model discovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('filters every non-chat category and inactive entries, case-insensitively', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [
      ...['WHISPER-large-v3', 'model-TTS', 'Orpheus-v1', 'PlayAI-v1', 'llama-Guard', 'GPT-Safeguard'].map(id => ({ id, active: true })),
      { id: 'inactive-chat', active: false }, { id: 'openai/gpt-oss-120b', active: true }, { id: 'chat-without-active' }
    ] }), { status: 200 })));
    // Changed 2026-10-15: V244, owner item I18, discovery lists only the approved Groq models.
    expect((await listGroqModels('', new AbortController().signal)).map(model => model.id)).toEqual(['openai/gpt-oss-120b']);
  });
  it('keeps reader-added models separately from filtered discovery', () => {
    const $ = load(render(createTutorViewState(), { tutorProvider: 'groq', customGroqModels: ['custom-tts'] }));
    expect($('[data-model-preset="tutor.model"] option[value="custom-tts"]').text()).toContain('custom-tts');
  });
});
