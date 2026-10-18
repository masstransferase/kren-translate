import { describe, expect, it } from 'vitest';
import {
  TUTOR_CUSTOM_SITUATION_ID,
  TUTOR_SITUATIONS,
  findTutorSituation,
  tutorCustomSituation,
  tutorSituationGroups
} from '../src/tutor/situations.js';

describe('the situations a conversation can be set in', () => {
  it('offers more than thirty, and no identifier is used twice', () => {
    expect(TUTOR_SITUATIONS.length).toBeGreaterThanOrEqual(30);
    const ids = TUTOR_SITUATIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * A setting missing where, who or what the reader wants leaves the model to invent it,
   * and an invented one drifts somewhere else by turn three. Length is a coarse proxy for
   * all three being present, so it is checked alongside the labels rather than instead.
   */
  it('gives every situation a label and a setting written to the reader', () => {
    for (const entry of TUTOR_SITUATIONS) {
      expect(entry.label.trim(), `${entry.id} has no label`).not.toBe('');
      expect(entry.setting.length, `${entry.id} setting is too short to place a scene`)
        .toBeGreaterThan(60);
      expect(entry.setting, `${entry.id} setting is not addressed to the reader`)
        .toMatch(/\bYou\b|\bYour\b/u);
    }
  });

  /*
   * The register is what the diagnostic protocol's fourth level measures a mismatch
   * against, so a situation without one silently disables that level for the whole
   * conversation rather than failing anywhere visible.
   */
  it('declares a register for every situation, drawn from the four allowed', () => {
    const allowed = ['casual', 'neutral', 'professional', 'formal'];
    for (const entry of TUTOR_SITUATIONS) {
      expect(allowed, `${entry.id} has an unusable register`).toContain(entry.register);
    }
    expect(new Set(TUTOR_SITUATIONS.map((entry) => entry.register)).size)
      .toBeGreaterThan(1);
  });

  it('derives its groups from the catalogue in list order, with none repeated', () => {
    const groups = tutorSituationGroups();
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups).toEqual([...new Set(TUTOR_SITUATIONS.map((entry) => entry.group))]);
    for (const entry of TUTOR_SITUATIONS) expect(groups).toContain(entry.group);
  });

  it('finds a situation by identifier and returns nothing for one that is not there', () => {
    expect(findTutorSituation('job-interview')?.label).toBe('A job interview');
    expect(findTutorSituation('no-such-situation')).toBeUndefined();
  });

  it('turns a reader description into a situation and refuses an empty one', () => {
    const written = tutorCustomSituation(
      '  I met my former supervisor at a conference, having a catch-up conversation.  '
    );
    expect(written?.id).toBe(TUTOR_CUSTOM_SITUATION_ID);
    expect(written?.setting).toBe(
      'I met my former supervisor at a conference, having a catch-up conversation.'
    );
    expect(tutorCustomSituation('   ')).toBeUndefined();
  });

  /*
   * Inferring a register from free text and then judging the reader against that inference
   * would let a level-4 finding rest on KREN's own guess, which is what that level forbids.
   * So a written situation is neutral whatever it says, including when it says otherwise.
   */
  it('does not infer a register from what the reader wrote', () => {
    expect(tutorCustomSituation('A very formal doctoral defence.')?.register).toBe('neutral');
    expect(tutorCustomSituation('Messing about with my brother.')?.register).toBe('neutral');
  });

  it('keeps the catalogue free of the identifier reserved for a written situation', () => {
    expect(TUTOR_SITUATIONS.some((entry) => entry.id === TUTOR_CUSTOM_SITUATION_ID)).toBe(false);
  });
});
