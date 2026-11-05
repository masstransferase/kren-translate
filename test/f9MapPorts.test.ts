// F9 (VS9MAP): the learning-map rows the sibling host still keeps (V10, V11). V12, a Review button on
// every Practice item, was reverted by the sibling host on 2026-10-31 and is not ported.
import { load } from 'cheerio';
import { parse as parseCss, type AtRule, type Rule } from 'postcss';
import { TUTOR_MAP } from '@kren/core/tutor';
import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorTargetActionReason } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function render(roles: readonly ('primary' | 'support')[]) {
  const skills = TUTOR_MAP.filter((node) => node.kind === 'skill');
  const state = createTutorViewState();
  // Selected targets fill the limits; the next skill is the one the dropdowns end on.
  state.selection = roles.map((role, index) => ({ nodeId: skills[index]!.id, role }));
  const deepest = skills[roles.length]!;
  state.mapPath[deepest.kind] = deepest.id;
  let parentId = deepest.parentId;
  while (parentId) {
    const parent = TUTOR_MAP.find((node) => node.id === parentId)!;
    state.mapPath[parent.kind] = parent.id;
    parentId = parent.parentId;
  }
  const html = renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: state, proModels: []
  });
  return { state, deepest, $: load(html) };
}

describe('V10: a limit that hides Primary or Support leaves its reason', () => {
  it('shows the Primary reason where the button would be when three Primary targets are chosen', () => {
    const { state, deepest, $ } = render(['primary', 'primary', 'primary']);
    const reason = tutorTargetActionReason(state.selection, deepest.id, 'primary');
    expect(reason, 'the limit must hide Primary for this fixture').toBeTruthy();
    const actions = $('.tutor-tray-actions');
    expect(actions).toHaveLength(1);
    const line = actions.find('[data-tutor-action-reason="primary"]');
    expect(line).toHaveLength(1);
    expect(line.text()).toBe(`Primary: ${reason}`);
    // The button is gone, so the line is the only thing said about Primary there.
    expect(actions.find('button[data-tutor-role="primary"]')).toHaveLength(0);
  });

  it('shows both reasons when both limits are full, and keeps Clear all', () => {
    const { state, deepest, $ } = render(['primary', 'primary', 'primary', 'support', 'support', 'support']);
    const primary = tutorTargetActionReason(state.selection, deepest.id, 'primary');
    const support = tutorTargetActionReason(state.selection, deepest.id, 'support');
    expect(primary && support).toBeTruthy();
    const actions = $('.tutor-tray-actions');
    expect(actions.find('[data-tutor-action-reason="primary"]').text()).toBe(`Primary: ${primary}`);
    expect(actions.find('[data-tutor-action-reason="support"]').text()).toBe(`Support: ${support}`);
    expect(actions.find('button[data-tutor-shared-action]')).toHaveLength(0);
    expect(actions.find('button[data-command="clearTutorTargets"]')).toHaveLength(1);
  });

  it('can be reached: not hidden, and inside the same open fold as Clear all', () => {
    const { $ } = render(['primary', 'primary', 'primary']);
    const line = $('[data-tutor-action-reason="primary"]');
    const clear = $('button[data-command="clearTutorTargets"]');
    expect(line).toHaveLength(1);
    for (const element of [line, ...line.parents().toArray().map((node) => $(node))]) {
      expect(element.attr('hidden'), 'no ancestor is hidden').toBeUndefined();
      expect(element.attr('aria-hidden'), 'no ancestor is aria-hidden').toBeUndefined();
    }
    // Whatever hides the reason hides the Clear all button beside it, so a reader who can see one sees both.
    expect(line.closest('details').attr('data-persist-id')).toBe(clear.closest('details').attr('data-persist-id'));
    expect(line.closest('.tutor-tray-actions')[0]).toBe(clear.closest('.tutor-tray-actions')[0]);
  });

  it('leaves the buttons alone when no limit applies', () => {
    const { $ } = render([]);
    expect($('[data-tutor-action-reason]')).toHaveLength(0);
    expect($('.tutor-tray-actions button[data-tutor-role="primary"]')).toHaveLength(1);
    expect($('.tutor-tray-actions button[data-tutor-role="support"]')).toHaveLength(1);
  });

  it('wraps the action row so a reason is never squeezed into a button column', () => {
    const { $ } = render(['primary', 'primary', 'primary']);
    let wrap: string | undefined;
    let basis: string | undefined;
    parseCss($('style').text()).walkRules((rule) => {
      if (rule.selector === '.tutor-tray-actions:has(> .tutor-action-reason)') rule.walkDecls('flex-wrap', (decl) => { wrap = decl.value; });
      if (rule.selector === '.tutor-tray-actions > span.tutor-action-reason') rule.walkDecls('flex', (decl) => { basis = decl.value; });
    });
    expect(wrap).toBe('wrap');
    expect(basis).toBe('1 1 100%');
  });
});

describe('V11: learning-map dropdowns stack under their label at 360 px and narrower', () => {
  it('has a max-width 360px rule that makes .tutor-map-level one column, after the .setting rule it overrides', () => {
    const { $ } = render([]);
    const root = parseCss($('style').text());
    let settingStart = -1;
    let stack: Rule | undefined;
    let stackStart = -1;
    root.walkRules(/^\.setting$/u, (rule) => { settingStart = rule.source!.start!.offset; });
    root.walkAtRules('media', (media: AtRule) => {
      if (!/\(max-width:\s*360px\)/u.test(media.params)) return;
      media.walkRules('.tutor-map-level', (rule) => { stack = rule; stackStart = rule.source!.start!.offset; });
    });
    expect(settingStart).toBeGreaterThan(-1);
    expect(stack, 'a .tutor-map-level rule inside @media (max-width: 360px)').toBeDefined();
    let columns: string | undefined;
    stack!.walkDecls('grid-template-columns', (decl) => { columns = decl.value; });
    expect(columns).toBe('minmax(0, 1fr)');
    expect(stackStart, 'the narrow rule must come after the base rule or it loses').toBeGreaterThan(settingStart);
  });

  it('keeps every dropdown full width and in the DOM', () => {
    const { $ } = render([]);
    expect($('.tutor-map-level select')).toHaveLength(4);
    let width: string | undefined;
    parseCss($('style').text()).walkRules('.tutor-map-level select', (rule) => { rule.walkDecls('width', (decl) => { width = decl.value; }); });
    expect(width).toBe('100%');
  });
});
