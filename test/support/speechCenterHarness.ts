import { SpeechCenter } from '../../src/speech/speechCenter.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from '../../src/speech/windowsSpeechAdapters.js';

/** Keep the existing mounted-panel fixtures while executing the actual shared center. */
export function mountSpeechCenter(context: any): SpeechCenter {
  const center = context.speechCenter ?? new SpeechCenter(context.chirpSpeech, context.readAloudChirpSpeech,
    new EdgeOnlineSpeechAdapter(context.edgeReadAloudPlayer), new LocalWindowsSpeechAdapter(context.readAloudPlayer), {
      configuration: () => context.vscode.workspace.getConfiguration('kren'),
      trusted: () => context.vscode.workspace.isTrusted,
      consent: () => context.ensureEdgeTtsConsent(context.context),
      active: value => context.vscode.commands.executeCommand('setContext', 'kren.readAloudActive', value),
      status: provider => context.vscode.window.setStatusBarMessage(provider === 'edgeOnline'
        ? '$(cloud-download) KREN: Generating and reading Edge voice...'
        : '$(unmute) KREN: Reading aloud...'),
      hold: () => context.resultsView.holdTutorSpeech(),
      started: () => context.resultsView.tutorSpeechPlaybackStarted(),
      liveSpeaking: () => context.resultsView.tutorLiveSpeaking(),
      conversation: () => context.resultsView.tutorSpeechConversationIdentity(),
      speakerVoice: () => context.resultsView.tutorSpeechVoice?.() ?? '',
      playback: () => context.resultsView.edgeAudioPlayback(),
      notify: context.notify,
      log: line => context.outputChannel.appendLine(line)
    });
  context.speechCenter = center;
  let session = context.readAloudSession ?? 0;
  // 2026-10-14: Old Stop probes incremented the extension session; the center now owns it.
  Object.defineProperty(context, 'readAloudSession', { configurable: true, get: () => session,
    set: value => { session = value; center.stop(); } });
  return center;
}
