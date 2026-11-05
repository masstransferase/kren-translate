import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2.0.3: the conversation's Speaker, Hint, Skip, Replay and Stop buttons are 32 px wide with 8 px
// padding, which leaves 14 px for an 18 px icon; the icon overflowed to the right by 2 px, most
// visibly the Stop square. Centering the icon's track splits the overflow evenly. Measured in
// headless Edge on the panel gallery: 2.00 px off center before, 0.00 px after.
describe('conversation action icons are centered (2.0.3)', () => {
  it('centers the icon track in the conversation action buttons', () => {
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    expect(panel).toContain('.tutor-composer-actions .icon-button { justify-content: center; }');
  });
});
