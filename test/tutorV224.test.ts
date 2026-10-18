// 2026-10-11: V224 exercises role continuity, the in-chat handler, and speech selection.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { tutorConversationOpeningRequest, tutorConversationTurnRequest, tutorConversationCorrectionsRequest,
  tutorConversationCoachingRequest, tutorConversationHintRequest, tutorConversationLiveSystemInstruction,
  tutorConversationDemoCastRequest, tutorConversationDemoBatchRequest, tutorConversationDiagnosisRequest, TUTOR_SITUATION_ROLES_SWAPPED,
  tutorConversationRequestControls } from '../src/tutor/generation.js';
import { tutorConversationStopRequest, tutorConversationTakeHomeRequest } from '../src/tutor/takeHome.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { SITUATION_PICTURE_ILLUSTRATED_STYLE, SITUATION_PICTURE_STYLE, buildCloudflarePictureRequest, buildSituationPictureRequest } from '../src/providers/situationPicture.js';

const controls = { rolesSwapped: true, learnerStarts: true, replyLength: 'medium' as const, coaching: 'teaching' as const };
// Changed 2026-10-15: V242, owner item I14, use a cooperative slant in the typed opening fixture.
const opening = { ...controls, kind: 'lesson' as const, register: 'professional' as const,
  primaryTargetLabel: 'Questions', supportingTargetLabels: [], sceneSlant: 'the counterpart is strong, competent, well prepared' as const };
const turn = { ...controls, register: 'professional' as const, teaching: true, recipeTargets: { supportingTargets: [] },
  transcript: [], question: 'What do you need?', learnerAnswer: 'I need help.' };
const corrections = { ...controls, register: turn.register, recipeTargets: turn.recipeTargets,
  turns: [{ question: turn.question, learnerAnswer: turn.learnerAnswer }] };
const card = { ...controls, source: 'lesson' as const, demo: false, register: turn.register,
  turns: [{ turnIndex: 0, question: turn.question, learnerAnswer: turn.learnerAnswer, reply: 'Of course.' }], demoLines: [] };

it.each(['lesson', 'situation', 'anything'] as const)('keeps swapped roles in a %s turn even without setting text', source => {
  const state = createTutorViewState();
  Object.assign(state.conversation, { from: source, rolesSwapped: true, starts: 'learner', replyLength: 'medium', coaching: 'teaching' });
  const request = tutorConversationTurnRequest({ ...turn, ...tutorConversationRequestControls(state.conversation) });
  expect(request.instruction).toContain(TUTOR_SITUATION_ROLES_SWAPPED);
  expect(request.instruction).toMatch(/you are the supervisor and the learner is the student/u);
  expect(JSON.parse(request.input)).toMatchObject(controls);
});
it('carries the same role contract and mode snapshot through every conversation request kind', () => {
  const character = { name: 'Alex', role: 'Supervisor', description: 'A supervisor.' };
  const requests = [tutorConversationOpeningRequest(opening), tutorConversationTurnRequest(turn),
    tutorConversationTurnRequest({ ...turn, learnerAnswer: '?????' }),
    tutorConversationCorrectionsRequest(corrections), tutorConversationCoachingRequest(tutorConversationTurnRequest(turn)),
    tutorConversationHintRequest({ ...controls, question: turn.question, setting: '', register: turn.register, recentTurns: [] }),
    tutorConversationDemoCastRequest({ ...opening, counterpartGender: 'male', readerSideGender: 'female' }),
    tutorConversationDemoBatchRequest({ ...controls, scene: 'A meeting.', male: character, female: { ...character, name: 'Sam' }, register: turn.register, transcript: [], exchanges: 2 }),
    tutorConversationTakeHomeRequest(card), tutorConversationStopRequest(corrections, card)];
  for (const request of requests) {
    // 2026-10-13: Preserve swapped assignments while distinguishing dialogue, coaching, and Demo.
    if (request.kind === 'conversationOpening' || request.kind === 'conversationTurn') {
      expect(request.instruction, request.kind).toContain(TUTOR_SITUATION_ROLES_SWAPPED);
    } else {
      expect(request.instruction, request.kind).toMatch(/roles are swapped.*learner played the other person/u);
      expect(request.instruction, request.kind).toMatch(request.kind.startsWith('conversationDemo')
        ? /both speakers.*assigned roles/u : /now coaching the learner.*learner's side says, never the tutor's side/u);
    }
    const input = JSON.parse(request.input);
    expect(request.kind === 'conversationStop' ? input.correctionsInput : input, request.kind).toMatchObject(controls);
  }
  expect(tutorConversationLiveSystemInstruction(opening, true, undefined, 'A meeting.')).toContain(TUTOR_SITUATION_ROLES_SWAPPED);
  // 2026-10-13: Diagnosis coaches the learner under the same swapped assignments.
  expect(tutorConversationDiagnosisRequest([], createTutorViewState().settings, undefined, { ...controls, register: turn.register }).instruction)
    .toMatch(/roles are swapped.*now coaching the learner.*learner's side says, never the tutor's side/u);
});

const panel = (activeScreen: 'tutor' | 'credentials' = 'tutor') => renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen, proModels: [],
  settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { googleCloudTranslation: true } }, tutor: createTutorViewState() });
it.each(['start', 'stop', 'handyPause'])('in-chat %s keeps page scroll still and routes answer focus correctly', action => {
  // Changed 2026-10-18: V263, owner item I43, test the mounted microphone and private Handy capture instead of a text box.
  const state = createTutorViewState();
  Object.assign(state.conversation, { status: 'active', replies: 'standard', from: 'anything', currentQuestion: 'A ready turn.' });
  state.speech.handyStatus = 'available';
  const mounted = mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', proModels: [],
    settings: PANEL_SETTINGS_FIXTURE, tutor: state, tutorSpeechProvider: 'handy' }), () => {});
  const control = mounted.query('[data-tutor-chat-mic-control]')!;
  mounted.click(control);
  const capture = mounted.query('[data-tutor-handy-capture]')!;
  expect(mounted.document.activeElement).toBe(capture);
  expect(capture.getAttribute('tabindex')).toBe('-1');
  expect(capture.getAttribute('aria-hidden')).toBe('true');
  expect(control.closest('details, [hidden]')).toBeNull();
  expect(mounted.query('[data-tutor-conversation-answer]')).toBeNull();
  expect(mounted.query('[data-tutor-chat-mic-control]')).toBe(control);
});
it('names the shared voices and exposes a keyboard-reachable Credentials Test action', () => {
  const $ = load(panel());
  const group = $('[data-tutor-voice-group="gemini"]');
  expect(group.find('h4').text()).toBe('Gemini Live and Chirp 3 HD Voice');
  expect(group.text()).toMatch(/same voices serve Gemini Live and Chirp 3 HD/u);
  const credentials = load(panel('credentials'));
  const button = credentials('[data-action="kren.testGoogleCloudTextToSpeech"]');
  expect(button).toHaveLength(1); expect(button.text()).toMatch(/Test/u);
  expect(button.attr('disabled')).toBeUndefined(); expect(button.attr('tabindex')).not.toBe('-1');
  expect(button.closest('details, [hidden], .hidden')).toHaveLength(0);
});
it('adds complete, well-proportioned people only to Illustrated on both picture routes', () => {
  expect(SITUATION_PICTURE_ILLUSTRATED_STYLE).toContain('with simple shapes and soft colors, and complete, well-proportioned people.');
  expect(SITUATION_PICTURE_ILLUSTRATED_STYLE).not.toMatch(/\b(no|not|never|without)\b/iu);
  expect(buildCloudflarePictureRequest('A meeting.', undefined, 'illustrated').prompt).toContain(SITUATION_PICTURE_ILLUSTRATED_STYLE);
  expect(buildSituationPictureRequest('A meeting.', undefined, 'illustrated').contents[0]!.parts[0]).toEqual(expect.objectContaining({ text: expect.stringContaining(SITUATION_PICTURE_ILLUSTRATED_STYLE) }));
  expect(buildCloudflarePictureRequest('A meeting.').prompt).toContain(SITUATION_PICTURE_STYLE);
  expect(SITUATION_PICTURE_STYLE).not.toContain('well-proportioned');
});
