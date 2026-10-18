/*
 * The situations now live in `@kren/core/tutor`, moved there on 2026-09-07 as phase T1 of
 * the Office port plan, so both hosts read one catalogue rather than two that agree today.
 *
 * This file stays as a re-export rather than being deleted, because deleting it would edit
 * every importer in the same commit as the move, and a move you cannot read as a move is
 * how a rebaseline hides a behaviour change inside a rename.
 */
export type {
  TutorSituation,
  TutorSituationGroup,
  TutorSituationRegister
} from '@kren/core/tutor';
export {
  TUTOR_CUSTOM_SITUATION_ID,
  TUTOR_SITUATIONS,
  findTutorSituation,
  tutorCustomSituation,
  tutorSituationGroups
} from '@kren/core/tutor';
