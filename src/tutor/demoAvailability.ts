import type { KrenPanelSettings } from '../resultViewHtml.js';

/** Demo uses Live narration except when Chirp is selected, and otherwise uses Speech Source. */
export function tutorDemoAvailable(replies: 'standard' | 'liveGemini',
  settings: Pick<KrenPanelSettings, 'tutorReadAloudProvider' | 'tutorProfile' | 'credentialPresence'>): boolean {
  const keys = settings.credentialPresence;
  if (settings.tutorReadAloudProvider === 'googleChirp') {
    return Boolean(keys?.googleCloudTextToSpeech || keys?.googleCloudTranslation);
  }
  if (replies === 'liveGemini') return Boolean(settings.tutorProfile === 'pro' ? keys?.geminiAlternate : keys?.geminiDefault);
  return settings.tutorReadAloudProvider === 'edgeOnline' || settings.tutorReadAloudProvider === 'windowsLocal';
}
