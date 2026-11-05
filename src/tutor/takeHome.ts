import { findTrainingMapNode, type TutorTakeHome } from '@kren/core/tutor';

/*
 * The take-home request, the one Stop request and the card reader moved into core 0.42.0 with
 * the other tutor request builders (V312). Re-exported here so every existing importer keeps
 * working and the move reads as a move. Session state and the spoken summary stay in KREN.
 */
export { tutorConversationTakeHomeRequest, tutorConversationStopRequest, tutorConversationTakeHome } from '@kren/core/tutor';
export type { TutorTakeHome, TutorTakeHomeInput } from '@kren/core/tutor';

export interface TutorTakeHomeState {
  identity: string;
  hidden?: boolean;
  canceled?: boolean;
  busy?: boolean;
  card?: TutorTakeHome;
  failure?: string;
  speechFailure?: string;
}

export function tutorTakeHomeSpeech(card: TutorTakeHome, _demo = false): string {
  const targets = (card.learningTargets ?? []).flatMap(target => {
    const node = findTrainingMapNode(target.targetId);
    return node ? [`${node.label}: ${target.why}`] : [];
  });
  return ['Take-home.', ...(card.naturally.length ? ['Say it naturally.', ...card.naturally.flatMap(entry => entry.alternatives)] : []),
    ...(targets.length ? ['Learning targets.', ...targets] : []),
    ...(card.pattern ? [`Pattern to keep: ${card.pattern.name}`, ...card.pattern.examples] : []),
    `Try next time: ${card.tryNext}`].join(' ');
}
