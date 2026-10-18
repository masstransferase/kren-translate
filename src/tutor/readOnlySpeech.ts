import { TutorLiveSession } from './liveSession.js';
import { TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION } from './generation.js';

/** Supplied text only: never opens or attaches a microphone. Shared with Demo reading. */
export function createTutorReadOnlySession(options: Omit<ConstructorParameters<typeof TutorLiveSession>[0], 'systemInstruction' | 'onText'>): TutorLiveSession {
  return new TutorLiveSession({ ...options, onText: () => undefined,
    systemInstruction: TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION +
      'Read exactly the supplied text. Add no words and do not answer it.' });
}
