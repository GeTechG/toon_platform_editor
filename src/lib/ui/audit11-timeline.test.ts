import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// Eleventh audit, the timeline. Svelte components are asserted as source, as
// in timeline-studio.test.ts: the runes need the compiler to run.
const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
const style = timeline.slice(timeline.indexOf('<style'));
const phone = style.slice(style.lastIndexOf('@media (max-width: 40rem)'));

function fn(name: string): string {
  return timeline.match(new RegExp(`function ${name}[\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('eleventh audit: picking a block of frames', () => {
  it('«Готово» hands focus back to the active cell, not to <body>', () => {
    // The button lives inside {#if picking}: pressed, it unmounted with focus.
    expect(timeline).toMatch(/class="key primary"[^>]*onclick=\{endPicking\}/);
    expect(fn('endPicking')).toMatch(/picking = false[\s\S]*\.cell\.active[\s\S]*focus\(\)/);
  });

  it('the chip does not float over the row above the timeline', () => {
    // Over the transport it hid Калька, Звук, Настройки and Черновики at every
    // width under ~1200 px — for the pointer and for Tab (WCAG 2.4.11). The
    // panels are arranged by hand, so what lies above is anyone's guess.
    const chip = style.match(/\.pick-bar\.picking \{[^}]*position: absolute;[^}]*\}/)?.[0] ?? '';
    expect(chip).not.toContain('bottom: calc(100%');
    expect(chip).toMatch(/top: 0;/);
  });

  it('on a phone the chip is a row of its own: the panel grows to take it', () => {
    expect(phone).toMatch(/\.pick-bar\.picking \{[^}]*position: static;/);
    expect(phone).toMatch(/\.pick-bar\.picking \{[^}]*box-shadow: none;/);
  });

  it('the chip keeps an edge in forced colours, where its shadow is dropped', () => {
    const forced = style.match(/@media \(forced-colors: active\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(forced).toMatch(/\.pick-bar\.picking \{[^}]*outline: 1px solid CanvasText/);
  });

  it('a finger scrolling from the empty strip does not collapse the block', () => {
    // A swipe starts with a press: begun between the cells it undid the pick.
    const reset = fn('resetSelection');
    expect(reset).toContain('picking');
    expect(reset).toContain("e.pointerType === 'touch'");
  });

  it('the hint says «нажми», the word the studio uses for every press', () => {
    expect(t('timeline.pick_hint')).not.toContain('Коснись');
    expect(t('timeline.pick_hint')).toContain('Нажми');
  });
});

describe('eleventh audit: the strip at 320 px and 200 % text', () => {
  it('the layer column never takes the whole strip', () => {
    // 10rem at 200 % is 320 px: the grid got 0 px and not a cell was left.
    expect(style).toMatch(/\.layer-col \{[^}]*max-width: 50%;/);
  });
});

describe('eleventh audit: a cell says whether it holds a drawing', () => {
  it('an empty cell is named empty, since the thumbnail is all a reader lacks', () => {
    expect(timeline).toContain("'timeline.cell_empty'");
    expect(t('timeline.cell_empty', { frame: 3, layer: 'Слой 1' })).toBe('Кадр 3, Слой 1, пусто');
  });
});

describe('eleventh audit: the frame menu at the frame limit', () => {
  it('«Добавить кадр» is disabled once the document holds MAX_FRAMES', () => {
    const menu = timeline.match(/class="frame-menu"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(menu).toMatch(/disabled=\{frameTotal >= MAX_FRAMES\} onclick=\{\(\) => run\(\(\) => editor\.addFrameAfterActive/);
  });
});

describe('eleventh audit: playback ended from outside', () => {
  it('stops the loop when a dropped file resets the document mid-preview', () => {
    // replaceDoc clears `playing`, and the loop ran on at 60 Hz behind a «play» key.
    expect(play).toMatch(/\$effect\(\(\) => \{\s*if \(editor\.playing \|\| !player\)[\s\S]*?cancelAnimationFrame\(rafId\)[\s\S]*?player = null/);
  });
});
