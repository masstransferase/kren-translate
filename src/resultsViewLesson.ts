import { runTutorContentRequest } from './requestCenter.js';
import { tutorProviderSwitchMessage } from './languageModelSwitching.js';
import { tutorConversationRequestControls } from './tutor/generation.js';
import { tutorLessonExcerptFindings } from './tutor/generation.js';
import { tutorPracticeBelongsToLesson } from './tutor/lessonConversation.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import type { TutorLanguageModelRoute } from './operations.js';
import type { TutorStructuredGenerationRequest } from './tutor/generation.js';
import type { TutorFinding, TutorRecipe } from '@kren/core/tutor';
import { cancelTutorAsk, invalidateTutorPracticeReport } from './resultsViewPractice.js';
import { tutorLanguageModelRoute } from './resultsViewConversation.js';
import { stopTutorConversation, tutorConversationTranscriptForModel } from './resultsViewTurns.js';
import { tutorConversationStopState } from './resultsViewStop.js';
import { cancelTutorSessionDictation } from './resultsViewDictation.js';
import { releaseTutorConversationResources } from './resultsViewLive.js';
import { cancelTutorTakeHome } from './resultsViewTakeHome.js';
import { tutorFailureMessage } from './resultsViewErrors.js';
import * as vscode from 'vscode';
import { tutorConversationDiagnosisRequest, tutorExerciseGenerationRequest, validateTutorExamplePracticeSet, type TutorExamplePracticeRequest, type TutorExamplePracticeSet, tutorLessonGenerationRequest, tutorPassageDiagnosisRequest, tutorDiagnosticReport, tutorTailoredPromptRequest, tutorWrittenPrompt, tutorTargetSearchSelection, tutorTargetSearchRequest, TUTOR_PASSAGE_ANALYSIS_CHOICES } from './tutor/generation.js';
import { findTutorTargets as rankTutorTargets } from './tutor/search.js';
import { changeTutorTarget, replaceTutorExample, replaceTutorExerciseSet, resetTutorGeneratedWork, resetTutorSession, tutorAllExamplesViewed, tutorHasLessonInput, tutorPracticeResults, tutorFindingMessage, tutorPreparedPrompt, tutorTailoredPrompt, tutorQuestionOnlySelection, tutorRecipeFromState, tutorSelectionReadiness, tutorTargetPathLabel, type TutorViewState } from './tutor/state.js';
import { findTrainingMapNode, validateTutorLesson, tutorLessonIsValid, type TrainingTargetRole, type TrainingTargetSelection, type TutorLesson } from '@kren/core/tutor';

function generateCheckedTutor(view: KrenResultsViewProvider, request: TutorStructuredGenerationRequest,
  route: TutorLanguageModelRoute, signal: AbortSignal, check: (value: unknown) => void): Promise<unknown> {
  return runTutorContentRequest({ request, route, signal, generate: view.actions.generateTutor.bind(view.actions),
    contentRetry: { allowance: 0 }, log: line => view.actions.log(line), validate: value => {
      check(value);
      return { type: 'accepted', value };
    } });
}

const PREPARED_PROMPT_REPLACED_NOTICE =
  'Your edited prepared prompt was replaced because the lesson recipe changed.';

export function regeneratePreparedPrompt(
  previous: TutorViewState,
  next: TutorViewState
): TutorViewState {
  if (previous.preparedPrompt === undefined) return next;
  // A report produces authored text, so a recipe change cannot rebuild it.
  if (previous.preparedPromptSource === 'tailored') return next;
  const editWasReplaced = previous.preparedPromptSource === 'edited' ||
    previous.preparedPromptSource === undefined;
  return {
    ...next,
    preparedPrompt: tutorPreparedPrompt({ ...next, preparedPromptSource: 'derived' }),
    preparedPromptSource: 'derived',
    preparedPromptNotice: editWasReplaced
      ? PREPARED_PROMPT_REPLACED_NOTICE
      : previous.preparedPromptNotice
  };
}

function requestWithPreparedPrompt(
  request: TutorStructuredGenerationRequest,
  state: TutorViewState
): TutorStructuredGenerationRequest {
  if (state.preparedPrompt === undefined) return request;
  return {
    ...request,
    instruction: `${request.instruction}\n\nThe reader reviewed and may have edited the prepared prompt below. The prepared prompt states what to teach about; the current recipe states which targets to teach it through. Generate lesson examples and practice to meet the prompt's objective subject to the selected targets and settings. A changed selection changes the constraints, never the objective. Keep the structured-output and privacy requirements above.\n\n${state.preparedPrompt}`
  };
}

/** The reader's own labels for the report's Delete dialogue, 2026-09-15. Cancel is added by VS Code. */
export const TUTOR_REPORT_DELETE_AND_RESET = 'Delete & Reset';
export const TUTOR_REPORT_DELETE_ONLY = 'Delete prompts';

function tutorRecipeMatchesState(recipe: TutorRecipe, state: TutorViewState): boolean {
  try {
    return JSON.stringify(recipe) === JSON.stringify(tutorRecipeFromState(state));
  } catch {
    return false;
  }
}



  /**
   * Ask prepares a lesson. It never drafts one.
   *
   * Three things changed here on 2026-09-03, all reported by the owner. Ask used to draft
   * immediately, so a reader who wanted to see what would be sent had already spent the
   * request. It consulted a model only when a separate setting was on, so the deliberate
   * action was the one place a model was absent. And it offered each candidate in a modal,
   * which is the reader doing work the model is better placed to do.
   *
   * So: always ask the model, let it name the Primary and the Supports, replace the
   * selection outright, prepare the prompt, and stop. The reader drafts.
   */
export async function askTutorQuestion(view: KrenResultsViewProvider, query: string): Promise<void> {
    const question = query.trim();
    if (!question) {
      await diagnoseSelectedEditorPassage(view);
      return;
    }
    const previousState = view.tutorState;
    const questionChanged = previousState.question !== question;
    view.tutorTargetSearchController?.abort();
    const controller = new AbortController();
    view.tutorTargetSearchController = controller;
    view.tutorState = { ...view.tutorState, mapSearch: query, askBusy: 'targetSearch' };
    view.render();

    let selection: TrainingTargetSelection[] = [];
    let sourceMessage: string;
    try {
      const response = await generateCheckedTutor(view,
        { ...tutorTargetSearchRequest(question), retry: previousState.question === question && Boolean(previousState.question) },
        tutorLanguageModelRoute(view),
        controller.signal, value => { tutorTargetSearchSelection(value); }
      );
      if (controller.signal.aborted) return;
      const matchedSelection = tutorTargetSearchSelection(response);
      selection = view.tutorState.settings.questionOnly
        ? tutorQuestionOnlySelection(matchedSelection)
        : matchedSelection;
      sourceMessage = selection.length > 0
        ? 'The model chose these learning-map targets for this question.'
        : 'The model found no learning-map target for this question. Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.';
    } catch (error) {
      if (controller.signal.aborted) return;
      view.showMissingCredentialError(error, true);
      view.actions.log(`Tutor target search failed: ${tutorFailureMessage(error)}`);
      sourceMessage = 'The model search failed. Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.';
    } finally {
      if (view.tutorTargetSearchController === controller) {
        view.tutorTargetSearchController = undefined;
      }
    }

    /*
     * The whole selection, not an addition to it. Asking a second question used to leave the
     * first question's targets in place, so a lesson could be drafted from a mixture of two
     * questions without the reader doing anything wrong.
     */
    const selectionChanged = JSON.stringify(selection) !==
      JSON.stringify(previousState.selection);
    const preparedState: TutorViewState = {
      ...view.tutorState,
      question,
      selection,
      questionPrepared: true,
      preparedPromptDrawerOpen: false,
      mapSearch: query,
      selectionMessage: sourceMessage,
      askBusy: undefined,
      lessonStale: view.tutorState.lessonStale ||
        Boolean(view.tutorState.lesson && questionChanged)
    };
    view.tutorState = previousState.preparedPrompt !== undefined &&
        (questionChanged || selectionChanged)
      ? regeneratePreparedPrompt(previousState, preparedState)
      : {
          ...preparedState,
          preparedPrompt: previousState.preparedPrompt ?? tutorPreparedPrompt(preparedState),
          preparedPromptSource: previousState.preparedPromptSource ?? 'derived'
        };
    view.render();
  }

export async function diagnoseSelectedEditorPassage(view: KrenResultsViewProvider): Promise<void> {
    const selectedPassage = view.actions.readSelectedEditorPassage();
    if (selectedPassage === undefined) {
      view.actions.notify('information', 'Select one passage in the editor first.');
      return;
    }
    const analysis = await view.showWarningMessage(
      'KREN will send this selected editor passage to the configured AI English Tutor provider. Which analysis should it run?',
      { modal: true, detail: selectedPassage },
      ...TUTOR_PASSAGE_ANALYSIS_CHOICES
    );
    if (analysis !== 'Weakness analysis' && analysis !== 'Text analysis') return;

    if (view.tutorState.askBusy === 'tailoredPrompt') cancelTutorAsk(view);
    view.tutorTargetSearchController?.abort();
    const controller = new AbortController();
    view.tutorTargetSearchController = controller;
    view.tutorState = { ...view.tutorState, askBusy: 'passageDiagnosis' };
    view.render();

    try {
      const response = await generateCheckedTutor(view,
        tutorPassageDiagnosisRequest(selectedPassage, analysis, view.tutorState.settings),
        tutorLanguageModelRoute(view),
        controller.signal, value => { tutorDiagnosticReport(value, selectedPassage, view.tutorState.settings.learnerLevel, analysis); }
      );
      if (controller.signal.aborted) return;
      const report = tutorDiagnosticReport(response, selectedPassage, view.tutorState.settings.learnerLevel, analysis);
      view.tutorState = {
        ...view.tutorState,
        diagnosticReport: report,
        diagnosticReportSource: { kind: 'passage' },
        diagnosticReportDrawerOpen: true,
        diagnosticReportMessage: undefined,
        preparedPromptDrawerOpen: false,
        askBusy: undefined
      };
      view.render();
    } catch (error) {
      if (controller.signal.aborted) return;
      view.showMissingCredentialError(error, true);
      view.actions.log(`Tutor passage diagnosis failed: ${tutorFailureMessage(error)}`);
      view.tutorState = {
        ...view.tutorState,
        askBusy: undefined,
        selectionMessage: 'The passage analysis failed. The selected targets were not changed.'
      };
      view.render();
    } finally {
      if (view.tutorTargetSearchController === controller) {
        view.tutorTargetSearchController = undefined;
      }
    }
  }

export async function applyTutorDiagnosticReport(view: KrenResultsViewProvider): Promise<void> {
    const report = view.tutorState.diagnosticReport;
    if (!report || report.targets.length === 0) return;
    // 2026-10-04: Apply discards closing work immediately, independently of prompt writing.
    cancelTutorTakeHome(view);
    const reportSource = view.tutorState.diagnosticReportSource?.kind ?? 'passage';
    view.tutorTailoredPromptController?.abort();
    const controller = new AbortController();
    view.tutorTailoredPromptController = controller;

    // Apply replaces the selection as one explicit action, using the manual target validator.
    const proposed = view.tutorState.settings.questionOnly
      ? tutorQuestionOnlySelection(report.targets)
      : [...report.targets].sort((left, right) => Number(right.role === 'primary') - Number(left.role === 'primary'));
    let selection: TrainingTargetSelection[] = [];
    const omissions: string[] = [];
    for (const target of proposed) {
      const changed = changeTutorTarget(selection, target.nodeId, target.role);
      selection = changed.selection;
      if (changed.refusal) omissions.push(`${findTrainingMapNode(target.nodeId)?.label}: ${changed.refusal}`);
    }
    // A cancelled Apply must keep even a question-derived or hand-edited prompt unchanged.
    applyTutorTargetChange(view, selection[0]?.nodeId ?? '', { selection }, true);
    const selectionMessage = [selection.length > 0
      ? `The selected learning-map targets came from the ${reportSource}.`
      : 'The analysis applied no learning-map targets.', ...omissions].join(' ');
    view.tutorState = {
      ...view.tutorState, askBusy: 'tailoredPrompt',
      selectionMessage,
      diagnosticReportMessage: undefined
    };
    const appliedReport = { ...report, targets: view.tutorState.selection };
    const fallback = tutorTailoredPrompt(appliedReport);
    view.render();

    let prompt: string;
    let usedFallback = false;
    try {
      const response = await generateCheckedTutor(view,
        tutorTailoredPromptRequest(report, view.tutorState.selection, view.tutorState.settings.learnerLevel),
        tutorLanguageModelRoute(view), controller.signal, value => {
          if (tutorWrittenPrompt(value) === undefined) throw new Error('The tailored prompt response was unusable.');
        }
      );
      if (controller.signal.aborted) return;
      const written = tutorWrittenPrompt(response);
      if (written === undefined) throw new Error('The tailored prompt response was unusable.');
      prompt = written;
    } catch {
      if (controller.signal.aborted) return;
      prompt = fallback;
      usedFallback = true;
      view.actions.log('Tutor tailored prompt generation failed; using the local fallback.');
    } finally {
      if (view.tutorTailoredPromptController === controller) view.tutorTailoredPromptController = undefined;
    }
    if (controller.signal.aborted) return;
    // Applying a new direction retires the generated work from the old one. This happens
    // only after prompt writing can no longer be cancelled, so Cancel leaves every artifact
    // and conversation resource intact.
    await releaseTutorConversationResources(view, true);
    cancelTutorSessionDictation(view);
    view.tutorPracticeDiagnosisController?.abort();
    view.tutorPracticeDiagnosisController = undefined;
    const resetWork = resetTutorGeneratedWork(view.tutorState);
    const fallbackNotice = "The model could not write a tailored prompt. This is KREN's own version, assembled from your report.";
    const readiness = tutorSelectionReadiness(resetWork);
    const readyMessage = readiness.ready
      ? 'KREN is ready to draft. You can edit the prepared prompt first.'
      : `Your tailored prompt is ready. Before drafting: ${readiness.summary}.`;
    view.tutorState = {
      ...resetWork,
      preparedPrompt: prompt,
      preparedPromptSource: 'tailored',
      tailoredPromptSelectionMessage: selectionMessage,
      preparedPromptNotice: usedFallback ? fallbackNotice
        : view.tutorState.preparedPrompt === undefined ? undefined
          : 'Your previous prepared prompt was replaced by applying this analysis.',
      diagnosticReportMessage: `The analysis was applied. The previous lesson, practice, and conversation were cleared. ${usedFallback ? `${fallbackNotice} ` : ''}${readyMessage}`,
      diagnosticReportDrawerOpen: false,
      preparedPromptDrawerOpen: false,
      askBusy: undefined
    };
    view.render();
  }

export async function findTutorTargets(view: KrenResultsViewProvider, query: string, rememberAsQuestion = false): Promise<void> {
    view.cancelTutorFind();
    const controller = new AbortController();
    view.tutorFindController = controller;
    view.tutorState = { ...view.tutorState, mapSearch: query };
    try {
      const hasQuestion = rememberAsQuestion && query.trim().length > 0;
      if (hasQuestion) {
        const questionChanged = view.tutorState.question !== query;
        view.tutorState = {
          ...view.tutorState,
          question: query,
          lessonStale: view.tutorState.lessonStale ||
            Boolean(view.tutorState.lesson && questionChanged)
        };
      }
      const candidateIds = rankTutorTargets(query).map((target) => target.id);
      for (const targetId of candidateIds) {
        const target = findTrainingMapNode(targetId);
        const asPrimary = changeTutorTarget(view.tutorState.selection, targetId, 'primary');
        const asSupport = changeTutorTarget(view.tutorState.selection, targetId, 'support');
        const choices: string[] = [];
        if (!asPrimary.refusal) choices.push('Set as primary');
        if (!asSupport.refusal) choices.push('Add as support');

        const unavailable = [
          asPrimary.refusal ? `Set as primary is not offered here: ${asPrimary.refusal}.` : '',
          asSupport.refusal ? `Add as support is not offered here: ${asSupport.refusal}.` : ''
        ].filter(Boolean).join(' ');
        const primaryOutcome = !asPrimary.refusal
          ? ' Setting it as Primary adds it to your Primary targets and keeps the other selected targets.'
          : '';
        const path = tutorTargetPathLabel(targetId) || target?.label || targetId;
        const choice = await view.showWarningMessage(
          `Search found ${path}. ${target?.description ?? ''} What would you like to do with it?` +
            primaryOutcome + (unavailable ? ` ${unavailable}` : ''),
          { modal: true, signal: controller.signal },
          ...choices
        );
        if (controller.signal.aborted) return;
        if (choice === 'Set as primary') applyTutorTargetChange(view, targetId,
          changeTutorTarget(view.tutorState.selection, targetId, 'primary'));
        if (choice === 'Add as support') applyTutorTargetChange(view, targetId,
          changeTutorTarget(view.tutorState.selection, targetId, 'support'));
        // Dismissing the modal is Cancel for this candidate. The loop still offers the next.
      }

      /*
       * Cancelling every candidate leaves the reader unable to draft, and until now only the
       * Ask path said so. Ask no longer offers candidates at all, so the message follows the
       * queue to Find, which is where the dead end still exists.
       *
       * Tested for a missing Primary rather than an empty selection, because a Support with no
       * Primary is reachable: changeTutorTarget deliberately excludes missingPrimary from its
       * refusals, so an empty-selection test leaves exactly that case silent.
       */
      const selectionOutcome = candidateIds.length === 0
        ? query.trim()
          ? 'No learning-map targets match that search.'
          : 'Enter a phrase to find learning-map targets.'
        : !view.tutorState.selection.some((target) => target.role === 'primary')
          ? 'No target was selected for this question. Choose a target in the dropdowns and use Primary, or type another question and choose Ask.'
          : undefined;
      view.tutorState = {
        ...view.tutorState,
        mapSearch: query,
        selectionMessage: selectionOutcome
      };
      view.render();
    } finally {
      if (view.tutorFindController === controller) view.tutorFindController = undefined;
    }
  }

export function applyTutorTargetChange(view: KrenResultsViewProvider, 
    targetId: string,
    changed: ReturnType<typeof changeTutorTarget>,
    preservePreparedPrompt = false,
    keyboardFocus = false
  ): void {
    const previousState = view.tutorState;
    const selection = previousState.settings.questionOnly
      ? tutorQuestionOnlySelection(changed.selection)
      : changed.selection;
    const selectionChanged = JSON.stringify(selection) !==
      JSON.stringify(previousState.selection);
    const target = findTrainingMapNode(targetId);
    const selected = selection.find((candidate) => candidate.nodeId === targetId);
    view.pendingTutorTargetFocus = keyboardFocus ? targetId : undefined;
    view.pendingTutorAnnouncement = changed.refusal ?? (selectionChanged
      ? selected
        ? `${target?.label ?? targetId} is now ${selected.role === 'primary' ? 'Primary' : 'Support'}.`
        : `${target?.label ?? targetId} is no longer selected.`
      : undefined);
    const nextState: TutorViewState = {
      ...previousState,
      selection,
      lessonStale: previousState.lessonStale ||
        Boolean(previousState.lesson && selectionChanged),
      selectionMessage: changed.refusal
    };
    view.tutorState = selectionChanged && !preservePreparedPrompt
      ? regeneratePreparedPrompt(previousState, nextState)
      : nextState;
    view.render();
  }

export async function updateTutorTarget(view: KrenResultsViewProvider, 
    targetId: string,
    role: TrainingTargetRole | 'off',
    keyboardFocus = false
  ): Promise<void> {
    if (view.tutorState.settings.questionOnly && role === 'primary') {
      role = 'support';
    }
    const changed = changeTutorTarget(view.tutorState.selection, targetId, role);
    applyTutorTargetChange(view, targetId, changed, false, keyboardFocus);
  }

  /*
   * Reset asks first, because everything it clears took the reader deliberate work to
   * produce and none of it can be brought back. The question names what goes and what
   * stays, so the answer does not depend on remembering which is which.
   */
export async function confirmTutorDiagnosticReportDeletion(view: KrenResultsViewProvider): Promise<void> {
    const state = view.tutorState;
    const report = state.diagnosticReport;
    if (!state.diagnosticReportDrawerOpen || !report) return;
    const busy = state.lessonBusy || state.exerciseBusy ||
      state.exampleBusyIds.length > 0 || state.reviewBusyIds.length > 0 ||
      state.conversation.busy;
    // Reset is withheld while other work runs, for the same reason Reset itself is.
    const choices = busy
      ? [TUTOR_REPORT_DELETE_ONLY]
      : [TUTOR_REPORT_DELETE_AND_RESET, TUTOR_REPORT_DELETE_ONLY];
    const choice = await view.showWarningMessage(
      'Delete this diagnostic report?',
      {
        modal: true,
        detail: (busy ? '' : `${TUTOR_REPORT_DELETE_AND_RESET} also clears the drafted lesson, the practice set with your answers and reviews, the conversation transcript, the lesson question, and every selected target, as Reset does. `) +
          `${TUTOR_REPORT_DELETE_ONLY} removes this report and keeps everything else.`
      },
      ...choices
    );
    // A report replaced while the dialogue was open is not the one the reader chose to delete.
    if (view.tutorState.diagnosticReport !== report) return;
    if (choice === TUTOR_REPORT_DELETE_AND_RESET) {
      if (view.tutorState.askBusy === 'tailoredPrompt') cancelTutorAsk(view);
      await releaseTutorConversationResources(view, true);
      cancelTutorSessionDictation(view);
      view.tutorConversationRawAnswers.clear();
      view.tutorPracticeDiagnosisController?.abort();
      view.tutorPracticeDiagnosisController = undefined;
      view.tutorConversationScene = undefined;
      view.pendingTutorAnnouncement = 'The diagnostic report was deleted and AI English Tutor was reset.';
      view.tutorState = resetTutorSession(view.tutorState);
      view.render();
      return;
    }
    if (choice !== TUTOR_REPORT_DELETE_ONLY) return;
    if (view.tutorState.askBusy === 'tailoredPrompt') cancelTutorAsk(view);
    view.tutorState = {
      ...view.tutorState, diagnosticReport: undefined, diagnosticReportSource: undefined,
      diagnosticReportDrawerOpen: false, diagnosticReportMessage: undefined
    };
    view.render();
  }


const wordCountFinding = (finding: TutorFinding) =>
  finding.code === 'lesson.wordCountBelowMinimum' || finding.code === 'lesson.wordCountAboveMaximum';

/** One quality retry belongs to the same explicit Draft or Regenerate action and route. */
async function generateTutorLessonWithQualityRetry(
  view: KrenResultsViewProvider, request: TutorStructuredGenerationRequest, signal: AbortSignal,
  recipe: TutorRecipe, route: TutorLanguageModelRoute, exampleId?: string
): Promise<unknown> {
  return runTutorContentRequest({ request, route, signal, generate: view.actions.generateTutor.bind(view.actions),
    contentRetry: { allowance: 1, on: ['wordCount', 'excerpt'] }, log: line => view.actions.log(line),
    validate: (value, attempt) => {
      const result = value as { examples?: TutorLesson['examples']; example?: TutorLesson['examples'][number] } | undefined;
      const examples = request.kind === 'example' ? result?.example ? [result.example] : []
        : Array.isArray(result?.examples) ? result.examples : [];
      const excerpts = tutorLessonExcerptFindings(examples).length > 0;
      let wordCounts = false;
      try {
        const lesson = request.kind === 'example' ? { ...view.tutorState.lesson!.lesson, examples } : value as TutorLesson;
        const findings = validateTutorLesson(lesson, recipe);
        wordCounts = findings.length > 0 && findings.every(wordCountFinding);
      } catch { /* The normal validation path reports malformed lessons. */ }
      const band = recipe.output.sentenceLength;
      const instruction = [excerpts ? 'The previous response had no short span to highlight in an example. Use only the few words that show the pattern as its excerpts, never the whole sentence. Explain why those words show it without repeating the sentence.' : '',
        wordCounts ? `The previous response had examples outside the requested word count. Write every example within ${band.minimumWords} to ${band.maximumWords} words.` : ''].filter(Boolean).join(' ');
      if (attempt === 0 && (excerpts || wordCounts)) return { type: 'rejected', cause: 'contentRejected',
        codes: [...(excerpts ? ['excerpt' as const] : []), ...(wordCounts ? ['wordCount' as const] : [])], correctiveInstruction: instruction };
      const current = view.tutorState.lesson;
      if (request.kind === 'example' && !result?.example) throw new Error('The provider did not return exactly one replacement example.');
      const lesson = request.kind === 'example'
        ? replaceTutorExample(current!.lesson, exampleId!, result!.example!)
        : value as TutorLesson;
      const checkedRecipe = request.kind === 'example' ? current!.recipe : recipe;
      const findings = lessonQualityFindings(validateTutorLesson(lesson, checkedRecipe), checkedRecipe, value, route, line => view.actions.log(line));
      if (!tutorLessonIsValid(findings)) {
        const messages = new Map<string, number>();
        for (const finding of findings) {
          const message = tutorFindingMessage(finding, { ...checkedRecipe.output.sentenceLength, log: line => view.actions.log(line) });
          messages.set(message, (messages.get(message) ?? 0) + 1);
        }
        throw new Error(tutorProviderSwitchMessage(value, route.provider, 'lesson', [...messages].map(([message, count]) =>
          count === 1 ? message : `${message} (${count} findings)`).join(' ')));
      }
      return wordCounts || excerpts ? { type: 'acceptedWithWarnings', value, warnings: [wordCounts ? 'wordCount' : 'excerpt'] }
        : { type: 'accepted', value };
    }
  });
}

function lessonQualityFindings(findings: TutorFinding[], recipe: TutorRecipe, value: unknown,
  route: TutorLanguageModelRoute, log: (line: string) => void): TutorFinding[] {
  if (!findings.length || !findings.every(wordCountFinding)) return findings;
  const context = { ...recipe.output.sentenceLength, log };
  const message = tutorProviderSwitchMessage(value, route.provider, 'lesson',
    [...new Set(findings.map(finding => tutorFindingMessage(finding, context)))].join(' '));
  // A presentation finding avoids the legacy renderer's incorrect "inside tolerance" wording.
  return [{ code: 'lesson.wordCountWarning', severity: 'warning', subjects: findings[0]!.subjects.slice(0, 1), detail: { message } }];
}

const tutorDraftWork = new WeakMap<AbortController, Pick<TutorViewState,
  'lessonRevision' | 'practiceLessonRevision' | 'viewedExampleIds'>>();

function restoreTutorDraftWork(view: KrenResultsViewProvider, controller: AbortController): void {
  const previous = tutorDraftWork.get(controller);
  if (previous) view.tutorState = { ...view.tutorState, ...previous };
  tutorDraftWork.delete(controller);
}

export function startTutorLessonGeneration(view: KrenResultsViewProvider): void {
    if (view.tutorState.exampleBusyIds.length > 0 || view.tutorExampleControllers.size > 0) return;
    if (!tutorHasLessonInput(view.tutorState)) return;
    // Changed 2026-10-01: Draft accepts the question being typed, without requiring Ask first.
    if (view.tutorState.mapSearch.trim()) {
      const previous = view.tutorState;
      const question = previous.mapSearch.trim();
      if (question !== previous.question) {
        view.tutorState = regeneratePreparedPrompt(previous, { ...previous, question });
      }
    }
    let recipe;
    try {
      recipe = tutorRecipeFromState(view.tutorState);
    } catch (error) {
      view.tutorState = {
        ...view.tutorState,
        lessonFailure: tutorFailureMessage(error)
      };
      view.showMissingCredentialError(error, true);
      view.render();
      return;
    }
    const preparedPrompt = view.tutorState.preparedPrompt;
    view.tutorLessonController?.abort();
    if (view.tutorLessonController) restoreTutorDraftWork(view, view.tutorLessonController);
    const controller = new AbortController();
    tutorDraftWork.set(controller, {
      lessonRevision: view.tutorState.lessonRevision,
      practiceLessonRevision: view.tutorState.practiceLessonRevision,
      viewedExampleIds: view.tutorState.viewedExampleIds
    });
    view.tutorLessonController = controller;
    const generation = ++view.tutorGeneration;
    view.tutorState = {
      ...view.tutorState,
      lessonBusy: true,
      lessonRevision: (view.tutorState.lessonRevision ?? 0) + 1,
      practiceLessonRevision: undefined,
      viewedExampleIds: [],
      lessonFailure: undefined
    };
    view.render();
    const route = tutorLanguageModelRoute(view);
    let response: unknown;
    void generateTutorLessonWithQualityRetry(view,
      requestWithPreparedPrompt(tutorLessonGenerationRequest(recipe), view.tutorState),
      controller.signal, recipe, route
    ).then((value) => {
      response = value;
      if (controller.signal.aborted || generation !== view.tutorGeneration) return;
      const lesson = value as TutorLesson;
      /*
       * The catch used to discard the error and report a fixed sentence, so every wrong
       * response read the same and the cause was gone. Core no longer throws on a
       * malformed lesson, which is the real fix; this stays as a backstop and now says
       * what happened and writes it to the output channel.
       */
      let findings;
      try {
        findings = lessonQualityFindings(validateTutorLesson(lesson, recipe), recipe, value, route, line => view.actions.log(line));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        view.actions.log(`Tutor lesson validation threw: ${detail}`);
        throw new Error(`AI English Tutor could not read the lesson it received. ${detail}`);
      }
      if (!tutorLessonIsValid(findings)) {
        const messageCounts = new Map<string, number>();
        for (const finding of findings) {
          const message = tutorFindingMessage(finding, { ...recipe.output.sentenceLength, log: line => view.actions.log(line) });
          messageCounts.set(message, (messageCounts.get(message) ?? 0) + 1);
        }
        throw new Error([...messageCounts].map(([message, count]) =>
            count === 1 ? message : `${message} (${count} findings)`
          ).join(' '));
      }
      findings.push(...tutorLessonExcerptFindings(lesson.examples));
      view.tutorState = {
        ...view.tutorState,
        lesson: { recipe, lesson, findings, preparedPrompt },
        preparedPromptDrawerOpen: false,
        lessonAnswersVisible: false,
        currentExampleIndex: 0,
        viewedExampleIds: [],
        lessonStale: !tutorRecipeMatchesState(recipe, view.tutorState),
        lessonFailure: undefined
      };
      view.pendingTutorResultFocus = 'lesson';
    }).catch((error: unknown) => {
      if (controller.signal.aborted || generation !== view.tutorGeneration) return;
      restoreTutorDraftWork(view, controller);
      view.tutorState = {
        ...view.tutorState,
        lessonFailure: tutorProviderSwitchMessage(response ?? error, route.provider, 'lesson', tutorFailureMessage(error))
      };
      view.showMissingCredentialError(error, true);
    }).finally(() => {
      tutorDraftWork.delete(controller);
      if (generation !== view.tutorGeneration) return;
      if (view.tutorLessonController === controller) view.tutorLessonController = undefined;
      view.tutorState = { ...view.tutorState, lessonBusy: false };
      view.render();
    });
  }

export function cancelTutorLesson(view: KrenResultsViewProvider): void {
    view.tutorGeneration += 1;
    view.tutorLessonController?.abort();
    if (view.tutorLessonController) restoreTutorDraftWork(view, view.tutorLessonController);
    view.tutorLessonController = undefined;
    view.tutorState = {
      ...view.tutorState,
      lessonBusy: false,
      lessonFailure: 'Lesson drafting was canceled.'
    };
    view.render();
  }

export function regenerateTutorExample(view: KrenResultsViewProvider, exampleId: string): void {
    if (view.tutorState.lessonBusy || view.tutorLessonController) return;
    const current = view.tutorState.lesson;
    if (!current || !current.lesson.examples.some((example) => example.id === exampleId) ||
        view.tutorExampleControllers.has(exampleId)) return;
    const oneExampleRecipe = {
      ...current.recipe,
      output: { ...current.recipe.output, exampleCount: 1 }
    };
    const controller = new AbortController();
    view.tutorExampleControllers.set(exampleId, controller);
    view.tutorState = {
      ...view.tutorState,
      exampleBusyIds: [...view.tutorState.exampleBusyIds, exampleId],
      exampleFailures: { ...view.tutorState.exampleFailures, [exampleId]: '' }
    };
    view.render();
    const route = tutorLanguageModelRoute(view);
    let response: unknown;
    void generateTutorLessonWithQualityRetry(view,
      tutorLessonGenerationRequest(oneExampleRecipe, exampleId),
      controller.signal, oneExampleRecipe, route, exampleId
    ).then((value) => {
      response = value;
      if (controller.signal.aborted || view.tutorExampleControllers.get(exampleId) !== controller) {
        return;
      }
      if (view.tutorState.lesson !== current) return;
      const generated = value as { example?: unknown };
      if (!generated || typeof generated !== 'object' || !generated.example) {
        throw new Error('The provider did not return exactly one replacement example.');
      }
      const replacementLesson = replaceTutorExample(
        current.lesson,
        exampleId,
        generated.example as TutorLesson['examples'][number]
      );
      let findings;
      try {
        findings = lessonQualityFindings(validateTutorLesson(replacementLesson, current.recipe), current.recipe, value, route, line => view.actions.log(line));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        view.actions.log(`Tutor replacement example validation threw: ${detail}`);
        throw new Error(`AI English Tutor could not read the replacement example it received. ${detail}`);
      }
      if (!tutorLessonIsValid(findings)) {
        throw new Error([...new Set(findings.map(finding => tutorFindingMessage(finding, { ...current.recipe.output.sentenceLength, log: line => view.actions.log(line) })))].join(' '));
      }
      findings.push(...tutorLessonExcerptFindings(replacementLesson.examples));
      view.tutorState = {
        ...view.tutorState,
        lesson: { ...current, lesson: replacementLesson, findings },
        viewedExampleIds: view.tutorState.viewedExampleIds.filter((id) => id !== exampleId),
        exampleFailures: { ...view.tutorState.exampleFailures, [exampleId]: '' }
      };
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      view.showMissingCredentialError(error, true);
      view.tutorState = {
        ...view.tutorState,
        exampleFailures: {
          ...view.tutorState.exampleFailures,
          [exampleId]: tutorProviderSwitchMessage(response ?? error, route.provider, 'lesson', tutorFailureMessage(error))
        }
      };
    }).finally(() => {
      if (view.tutorExampleControllers.get(exampleId) !== controller) return;
      view.tutorExampleControllers.delete(exampleId);
      view.tutorState = {
        ...view.tutorState,
        exampleBusyIds: view.tutorState.exampleBusyIds.filter((id) => id !== exampleId)
      };
      view.render();
    });
  }

export function cancelTutorExample(view: KrenResultsViewProvider, exampleId: string): void {
    view.tutorExampleControllers.get(exampleId)?.abort();
    view.tutorExampleControllers.delete(exampleId);
    view.tutorState = {
      ...view.tutorState,
      exampleBusyIds: view.tutorState.exampleBusyIds.filter((id) => id !== exampleId),
      exampleFailures: {
        ...view.tutorState.exampleFailures,
        [exampleId]: 'This example redraft was canceled.'
      }
    };
    view.render();
  }

export function generateTutorExercises(view: KrenResultsViewProvider): void {
    if (view.tutorExerciseController) return;
    const currentPractice = tutorPracticeBelongsToLesson(view.tutorState);
    if (view.tutorState.lessonBusy || (!currentPractice && !tutorAllExamplesViewed(view.tutorState))) return;
    // Refused here as well as disabled in the page, which may be a stale render.
    if (currentPractice && !tutorPracticeResults(view.tutorState)) return;
    let recipe;
    try {
      recipe = view.tutorState.lesson?.recipe ?? tutorRecipeFromState(view.tutorState);
    } catch (error) {
      view.showMissingCredentialError(error, true);
      view.tutorState = { ...view.tutorState, exerciseFailure: tutorFailureMessage(error) };
      view.render();
      return;
    }
    const lessonRevision = view.tutorState.lessonRevision;
    const request: TutorExamplePracticeRequest = {
      schemaVersion: 1,
      recipe,
      count: view.tutorState.settings.exerciseCount,
      channel: 'written',
      examples: (view.tutorState.lesson?.lesson.examples ?? []).map(({ sentence, targetIds, annotations }) => ({
        sentence, targetIds: [...targetIds], annotations: annotations.map(({ targetId, excerpt, explanation }) => ({ targetId, excerpt, explanation }))
      }))
    };
    const controller = new AbortController();
    view.tutorExerciseController = controller;
    view.tutorState = { ...view.tutorState, exerciseBusy: true, practiceLessonRevision: undefined, exerciseFailure: undefined };
    view.render();
    const route = tutorLanguageModelRoute(view);
    let response: unknown;
    void generateCheckedTutor(view,
      requestWithPreparedPrompt(tutorExerciseGenerationRequest(request), view.tutorState.lesson
        ? { ...view.tutorState, preparedPrompt: view.tutorState.lesson.preparedPrompt } : view.tutorState),
      route,
      controller.signal, value => {
        response = value;
        const findings = validateTutorExamplePracticeSet(value as TutorExamplePracticeSet, request);
        if (findings.length > 0) throw new Error([...new Set(findings.map(finding =>
          tutorFindingMessage(finding, { ...recipe.output.sentenceLength, log: line => view.actions.log(line) })))].join(' '));
      }
    ).then((value) => {
      response = value;
      if (controller.signal.aborted || view.tutorExerciseController !== controller || lessonRevision !== view.tutorState.lessonRevision) return;
      const exerciseSet = value as TutorExamplePracticeSet;
      let findings;
      try {
        findings = validateTutorExamplePracticeSet(exerciseSet, request);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        view.actions.log(`Tutor exercise validation threw: ${detail}`);
        throw new Error(`AI English Tutor could not read the practice set it received. ${detail}`);
      }
      if (findings.length > 0) throw new Error([...new Set(findings.map(finding => tutorFindingMessage(finding, { ...recipe.output.sentenceLength, log: line => view.actions.log(line) })))].join(' '));
      invalidateTutorPracticeReport(view);
      for (const hint of view.tutorHintControllers.values()) hint.abort();
      view.tutorHintControllers.clear();
      view.tutorState = {
        ...replaceTutorExerciseSet(view.tutorState, {
          ...exerciseSet,
          exercises: exerciseSet.exercises.map(({ exampleIndex, expectedAnswer, ...exercise }) => exercise)
        }),
        practiceExamples: Object.fromEntries(exerciseSet.exercises.map((exercise) => [exercise.id, {
          exampleIndex: exercise.exampleIndex!, sentence: request.examples[exercise.exampleIndex!]!.sentence
        }])),
        exerciseFailure: undefined
      };
      view.pendingTutorResultFocus = 'exercises';
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      view.showMissingCredentialError(error, true);
      view.tutorState = { ...view.tutorState, exerciseFailure: tutorProviderSwitchMessage(response ?? error, route.provider, 'practice set', tutorFailureMessage(error)) };
    }).finally(() => {
      if (view.tutorExerciseController !== controller) return;
      view.tutorExerciseController = undefined;
      view.tutorState = { ...view.tutorState, exerciseBusy: false };
      view.render();
    });
  }

export function cancelTutorExercises(view: KrenResultsViewProvider): void {
    view.tutorExerciseController?.abort();
    view.tutorExerciseController = undefined;
    view.tutorState = {
      ...view.tutorState,
      exerciseBusy: false,
      exerciseFailure: 'The practice request was canceled.'
    };
    view.render();
  }

export async function diagnoseTutorConversation(view: KrenResultsViewProvider): Promise<void> {
    let turns = tutorConversationTranscriptForModel(view).filter((turn) => !turn.skipped && !turn.learnerNotShown);
    if (turns.length < 5) {
      view.tutorState = { ...view.tutorState, diagnosticReportMessage: 'Have a few more turns first.' };
      view.render();
      return;
    }
    if (view.tutorState.conversation.status === 'active') {
      if (tutorConversationStopState(view).disabled) return;
      const choice = await view.showWarningMessage(
        'To diagnose now, KREN will stop the current conversation.',
        { modal: true }, 'Proceed'
      );
      if (choice !== 'Proceed' || view.tutorState.conversation.status !== 'active' ||
          tutorConversationStopState(view).disabled) return;
      await stopTutorConversation(view);
      turns = tutorConversationTranscriptForModel(view).filter((turn) => !turn.skipped && !turn.learnerNotShown);
    }
    if (turns.some((turn) => turn.coachingPending)) {
      view.tutorState = {
        ...view.tutorState,
        diagnosticReportMessage: 'Stop the conversation first so KREN can check every turn.'
      };
      view.render();
      return;
    }
    if (view.tutorState.askBusy === 'conversationDiagnosis') return;
    if (view.tutorState.diagnosticReport && view.tutorState.diagnosticReportSource?.kind === 'conversation' &&
        view.tutorState.diagnosticReportSource.turnCount === turns.length) {
      view.tutorState = { ...view.tutorState, diagnosticReportDrawerOpen: true, preparedPromptDrawerOpen: false };
      view.render();
      return;
    }
    if (view.tutorState.askBusy !== undefined) cancelTutorAsk(view);
    const controller = new AbortController();
    view.tutorTargetSearchController = controller;
    const learnerLevel = view.tutorState.settings.learnerLevel;
    view.tutorState = { ...view.tutorState, askBusy: 'conversationDiagnosis', diagnosticReportMessage: undefined };
    view.render();
    try {
      const response = await generateCheckedTutor(view,
        tutorConversationDiagnosisRequest(turns, view.tutorState.settings, undefined, {
          ...tutorConversationRequestControls(view.tutorState.conversation), register: view.tutorState.conversation.register
        }), tutorLanguageModelRoute(view), controller.signal, value => {
          tutorDiagnosticReport(value, turns.map(turn => turn.learnerAnswer), learnerLevel);
        }
      );
      if (controller.signal.aborted) return;
      const report = tutorDiagnosticReport(response, turns.map((turn) => turn.learnerAnswer), learnerLevel);
      view.tutorState = {
        ...view.tutorState, diagnosticReport: report,
        diagnosticReportSource: { kind: 'conversation', turnCount: turns.length },
        diagnosticReportDrawerOpen: true, preparedPromptDrawerOpen: false, askBusy: undefined
      };
    } catch (error) {
      if (controller.signal.aborted) return;
      view.showMissingCredentialError(error, true);
      view.actions.log(`Tutor conversation diagnosis failed: ${tutorFailureMessage(error)}`);
      view.tutorState = {
        ...view.tutorState, askBusy: undefined,
        diagnosticReportMessage: 'The conversation analysis failed. Try Diagnose conversation again.'
      };
    } finally {
      if (view.tutorTargetSearchController === controller) view.tutorTargetSearchController = undefined;
      view.render();
    }
  }

export function invalidateTutorConversationReport(view: KrenResultsViewProvider, discardTakeHome = true): void {
    if (discardTakeHome && view.tutorState.conversation.takeHome) cancelTutorTakeHome(view);
    // A completed turn or a new session changes the evidence, including while diagnosis is pending.
    if (view.tutorState.askBusy === 'conversationDiagnosis') {
      cancelTutorAsk(view);
      view.tutorState = {
        ...view.tutorState,
        diagnosticReportMessage: 'The conversation changed. Diagnose conversation again for a current report.'
      };
    }
    if (view.tutorState.diagnosticReportSource?.kind !== 'conversation') return;
    view.tutorState = {
      ...view.tutorState, diagnosticReport: undefined, diagnosticReportSource: undefined,
      diagnosticReportDrawerOpen: false,
      diagnosticReportMessage: 'The conversation changed. Diagnose conversation again for a current report.'
    };
  }

