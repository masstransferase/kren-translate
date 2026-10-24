import { runTutorContentRequest } from './requestCenter.js';
import { tutorLanguageModelRoute } from './resultsViewConversation.js';
import { tutorConversationRequestControls } from './tutor/generation.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { generateTutorConversation } from './resultsViewConversation.js';
import { tutorConversationTranscriptForModel } from './resultsViewTurns.js';
import { tutorLearnerTurnNotShown } from './tutor/learnerLanguage.js';
import { tutorConversationTakeHomeRequest, tutorConversationTakeHome, tutorTakeHomeSpeech, type TutorTakeHomeInput } from './tutor/takeHome.js';
import { renderTutorTakeHome, renderTutorConversationReview } from './resultViewHtml.js';
import { readTutorConversationText } from './resultsViewReplay.js';
import { safePanelErrorMessage } from './resultsViewErrors.js';
import { ProviderError } from './errors.js';

export function postTutorTakeHome(view: KrenResultsViewProvider): void {
  void view.view?.webview.postMessage({ command: 'tutorTakeHomeReady', html: renderTutorTakeHome(view.tutorState.conversation) });
  void view.view?.webview.postMessage({ command: 'tutorConversationReviewReady',
    html: renderTutorConversationReview(view.tutorState, view.actions.settings().tutorConversationTakeHome !== false) });
}
export function stopTutorTakeHomeSpeech(view: KrenResultsViewProvider): void {
  view.tutorTakeHomeSpeechController?.abort();
  view.tutorTakeHomeSpeechController = undefined;
  view.tutorTakeHomeSession?.close();
  view.tutorTakeHomeSession = undefined;
  view.tutorTakeHomePlayer?.close();
  view.tutorTakeHomePlayer = undefined;
  if (view.tutorTakeHomeSpeaking) view.actions.stopReadAloud();
  view.tutorTakeHomeSpeaking = false;
}
export function cancelTutorTakeHome(view: KrenResultsViewProvider, mode: 'discard' | 'hide' | 'cancel' | 'retain' = 'discard'): void {
  view.tutorTakeHomeController?.abort();
  view.tutorTakeHomeController = undefined;
  stopTutorTakeHomeSpeech(view);
  const prior = view.tutorState.conversation.takeHome;
  view.tutorState = { ...view.tutorState, conversation: { ...view.tutorState.conversation,
    takeHome: mode === 'discard' || (mode === 'retain' && !prior?.card) ? undefined : prior ? {
      ...prior, busy: false, hidden: mode === 'retain' ? prior.hidden : true,
      canceled: mode === 'cancel' || prior.canceled,
      ...(prior.busy ? { failure: 'The take-home card was canceled. Try again.' } : {})
    } : undefined } };
  postTutorTakeHome(view);
}
export function reconcileTutorTakeHomeSetting(view: KrenResultsViewProvider): void {
  if (view.actions.settings().tutorConversationTakeHome !== false) return;
  if (view.tutorState.conversation.takeHome?.busy) cancelTutorTakeHome(view);
  else stopTutorTakeHomeSpeech(view);
}
export function tutorTakeHomeInput(view: KrenResultsViewProvider): TutorTakeHomeInput {
  const c = view.tutorState.conversation;
  const coach = c.from === 'speakAndRephrase';
  return { ...tutorConversationRequestControls(c), source: c.from, demo: Boolean(c.demoMode), register: c.register,
    turns: c.demoMode ? [] : tutorConversationTranscriptForModel(view).flatMap((turn, turnIndex) =>
      turn.skipped || turn.learnerNotShown || tutorLearnerTurnNotShown(turn.learnerAnswer) ? [] : [{
        turnIndex, learnerAnswer: turn.learnerAnswer,
        ...(coach ? { correction: turn.correction, rephrase: turn.rephrase, rephraseWhy: turn.rephraseWhy }
          : { question: turn.question, reply: turn.reply ?? '' }),
        ...(turn.spoken !== undefined ? { spoken: turn.spoken } : {}) }]),
    demoLines: c.demoMode ? c.demoLines.map(({ speaker, text }) => ({ speaker, text })) : [],
    ...(!coach && c.lessonContext ? { lessonContext: c.lessonContext } : {}) };
}
function tutorTakeHomeIdentity(input: TutorTakeHomeInput): string {
  return JSON.stringify({ demo: input.demo, turns: input.turns, demoLines: input.demoLines });
}
export function reconcileTutorStoppedTakeHome(view: KrenResultsViewProvider): void {
  const prior = view.tutorState.conversation.takeHome;
  if (!prior) return;
  if (prior.identity !== tutorTakeHomeIdentity(tutorTakeHomeInput(view))) {
    cancelTutorTakeHome(view);
  } else if (prior.card && !prior.canceled) {
    view.tutorState.conversation.takeHome = { ...prior, hidden: false };
    postTutorTakeHome(view);
  }
}
export function finalizeTutorTakeHome(view: KrenResultsViewProvider, retry = false,
  prepared?: { input: TutorTakeHomeInput; value: unknown }): void {
  if (!(view.actions.settings().tutorConversationTakeHome ?? TUTOR_DEFAULTS.configuration['tutor.conversation.takeHome'])) return;
  if (view.tutorState.conversation.status !== 'stopped') return;
  if (view.tutorState.conversation.busy) return;
  const input = prepared?.input ?? tutorTakeHomeInput(view);
  if (!(input.demo ? input.demoLines.some(line => line.text.trim()) : input.turns.some((turn) => turn.learnerAnswer.trim()))) {
    cancelTutorTakeHome(view);
    return;
  }
  const identity = tutorTakeHomeIdentity(input);
  const prior = view.tutorState.conversation.takeHome;
  if (!retry && prior?.identity === identity && (prior.card || prior.busy)) {
    view.tutorState.conversation.takeHome = { ...prior, hidden: false, canceled: false };
    postTutorTakeHome(view);
    return;
  }
  cancelTutorTakeHome(view);
  const controller = new AbortController();
  view.tutorTakeHomeController = controller;
  view.tutorState.conversation.takeHome = { identity, busy: true };
  postTutorTakeHome(view);
  void (async () => {
    try {
      const card = await runTutorContentRequest({ request: tutorConversationTakeHomeRequest(input),
        route: tutorLanguageModelRoute(view), signal: controller.signal,
        generate: (request, _route, signal) => generateTutorConversation(view, request, signal),
        ...(prepared ? { initial: { value: prepared.value } } : {}), contentRetry: { allowance: 0 },
        log: line => view.actions.log(line), validate: value => {
          let salvaged = false;
          const card = tutorConversationTakeHome(value, input, line => {
            salvaged ||= /dropped|trimmed/u.test(line);
            view.actions.log(line);
          });
          return salvaged ? { type: 'salvaged', value: card, warnings: ['contentRejected'] } : { type: 'accepted', value: card };
        }
      });
      if (controller.signal.aborted || view.tutorTakeHomeController !== controller) return;
      view.tutorState.conversation.takeHome = { identity, card };
      postTutorTakeHome(view);
      void speakTutorTakeHome(view);
    } catch (error) {
      if (controller.signal.aborted || view.tutorTakeHomeController !== controller) return;
      view.showMissingCredentialError(error, true);
      // 2026-10-12: the card uses safe error categories, never provider message text.
      view.actions.log(`[conversation take-home failed] ${safePanelErrorMessage(error)}`);
      const failure = error instanceof ProviderError && error.reason === 'quotaExhausted'
        ? "The selected provider's free limit is used up for today. Try again tomorrow or choose another provider."
        : error instanceof ProviderError && error.status === undefined && error.action?.startsWith('set')
          ? "The take-home card needs the selected provider's key. Open KREN menu, Credentials, then choose Try again."
          : 'The take-home card could not be prepared. Try again.';
      view.tutorState.conversation.takeHome = { identity, failure };
      postTutorTakeHome(view);
    } finally {
      if (view.tutorTakeHomeController === controller) view.tutorTakeHomeController = undefined;
    }
  })();
}
export async function speakTutorTakeHome(view: KrenResultsViewProvider): Promise<void> {
  const c = view.tutorState.conversation;
  if (view.actions.settings().tutorConversationTakeHome === false || !c.speakerOn || !c.takeHome?.card || c.takeHome.hidden || c.replayAllSpeaking) return;
  stopTutorTakeHomeSpeech(view);
  const controller = new AbortController();
  view.tutorTakeHomeSpeechController = controller;
  view.tutorTakeHomeSpeaking = true;
  const text = tutorTakeHomeSpeech(c.takeHome.card, Boolean(c.demoMode));
  const current = () => !controller.signal.aborted && view.tutorTakeHomeSpeechController === controller && view.tutorState.conversation.speakerOn;
  const failed = () => {
    if (!current()) return;
    const card = view.tutorState.conversation.takeHome;
    if (card) view.tutorState.conversation.takeHome = { ...card, speechFailure: 'The card could not be read aloud. Its text is still available.' };
    postTutorTakeHome(view);
    stopTutorTakeHomeSpeech(view);
  };
  try {
    if (current()) await readTutorConversationText(view, text);
    if (current()) { view.tutorTakeHomeSpeaking = false; view.tutorTakeHomeSpeechController = undefined; }
  } catch { failed(); }
}
