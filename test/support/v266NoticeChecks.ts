import assert from 'node:assert/strict';
import { queueHostV265, flushV265 } from './v265QueueChecks.js';
import { questionV267 } from './v267NativeDialogs.js';
import { findTutorTargets } from '../../src/tutor/search.js';

const flush = flushV265;

// Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
/** Journey through the registered receiver, shipped page, and native dialog boundary. */
export async function checkV266Journey() {
  const h = queueHostV265();
  try {
    h.receive({ command: 'showTutor' }); await flush();
    const search = h.panel().query('[data-tutor-map-search]')!;
    search.value = 'past tense'; h.panel().input(search, 'insertText');
    assert.ok(findTutorTargets(search.value).length >= 2);
    h.panel().click(h.panel().query('[data-tutor-find-targets]')!); await flush();
    assert.match(questionV267(h).message, /Search found/u);
    for (const choice of ['Set as primary', 'Add as support']) {
      const dialog = questionV267(h);
      assert.deepEqual(dialog.choices, ['Set as primary', 'Add as support']);
      assert.equal(dialog.options.modal, true);
      dialog.answer(choice); await flush();
    }
    for (let remaining = 0; remaining < 20; remaining++) {
      const count = h.dialogs.length;
      h.dialogs.at(-1)?.answer(); await flush();
      if (h.dialogs.length === count) break;
    }
    assert.ok(h.view.tutorState.selection.some(target => target.role === 'primary'));
    assert.ok(h.view.tutorState.selection.some(target => target.role === 'support'));
    const reset = h.panel().query('[data-command="resetTutorSession"]')!;
    assert.equal(reset.closest('details, [hidden], .hidden'), null, 'Reset must be outside collapsed sections');
    h.panel().click(reset); await flush();
    assert.match(questionV267(h).message, /Reset the AI English Tutor/u);
    questionV267(h).answer('Reset panel'); await flush();
    assert.equal(h.view.tutorState.selection.length, 0, 'The native answer must reset the tutor');
    h.receive({ command: 'showSettings' }); await flush();
    const usage = h.panel().query('details[data-persist-id="settings-usage"]');
    if (usage) usage.open = true;
    const defaults = h.panel().query('[data-action="kren.restoreDefaultSettings"]');
    assert.ok(defaults, 'Settings must expose Default Setting');
    h.panel().click(defaults); await flush();
    assert.match(questionV267(h).message, /Return every KREN setting/u);
    questionV267(h).answer(); await flush();
    assert.equal(h.panel().query('[data-kren-notice]'), null);
    h.receive({ command: 'copy' }); await flush(); assert.equal(h.copyCalls(), 1);
  } finally { h.view.dispose(); }
}

// Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
export async function checkV266FindQueue() {
  const h = queueHostV265();
  try {
    h.receive({ command: 'findTutorTargets', search: 'past tense' }); await flush();
    const old = questionV267(h);
    h.receive({ command: 'updateTutorSearch', search: 'articles' }); await flush();
    assert.equal(h.view.tutorState.mapSearch, 'articles', 'A pending Find must release the settings queue');
    h.receive({ command: 'findTutorTargets', search: 'articles' }); await flush();
    const newer = questionV267(h);
    h.receive({ command: 'resetTutorSession' }); await flush();
    const reset = questionV267(h);
    assert.match(reset.message, /Reset the AI English Tutor/u, 'Reset must ask immediately beside a pending Find');
    old.answer('Set as primary'); newer.answer('Set as primary'); await flush();
    assert.equal(h.view.tutorState.selection.length, 0, 'A retired Find choice must not change the selection');
    reset.answer('Reset panel'); await flush();
    newer.answer('Add as support'); await flush();
    assert.equal(h.view.tutorState.selection.length, 0);
    assert.equal(h.panel().query('[data-kren-notice]'), null, 'Reset must not reveal another old candidate');
  } finally { h.view.dispose(); }
}
