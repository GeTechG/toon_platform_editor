import { describe, expect, it } from 'bun:test';
import { panelsFrom, stageRailShown } from './panels';

// Owner, 2026-10-06: «дублируется, нужно оставить что-то одно». The sidebar's
// slider and the finger's rail on the stage are the same thickness: where the
// first is drawn, the second is not.
const open = { left: false, right: false, rows: false };
const sidebar = panelsFrom({ base: { left: ['brush-rail', 'history'] } });

describe('one thickness slider at a time', () => {
  it('the sidebar holds the slider: no rail on the stage', () => {
    expect(stageRailShown(sidebar, open)).toBe(false);
  });

  it('no slider in the arrangement: the rail stays for a finger', () => {
    expect(stageRailShown(panelsFrom({ base: { left: ['history'] } }), open)).toBe(true);
  });

  it('the column folded away takes its slider with it: the rail is back', () => {
    expect(stageRailShown(sidebar, { ...open, left: true })).toBe(true);
  });

});
