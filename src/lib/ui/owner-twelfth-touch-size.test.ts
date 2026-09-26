import { describe, expect, it } from 'bun:test';
import { SIZE_TRACK, positionOfSize, sizeAtPosition, sizeAtRail, sizeByKey } from './size-scale';
import { t } from '../i18n';

// Owner: «для пальца — как в Procreate Dreams». Dreams sizes the brush with a
// vertical slider on the edge of the stage, not a canvas gesture; so does the
// canvas here, for a hand that touches. The mapping runs for real, the markup
// is asserted as source.
const UI = new URL('./', import.meta.url).pathname;
const canvas = await Bun.file(UI + 'CanvasView.svelte').text();
const panel = await Bun.file(UI + 'BrushPanel.svelte').text();
const ux = { adaptiveBrushStep: false, brushSizeMax: 640 } as never;

describe('the rail maps the finger onto the slider’s own logarithmic track', () => {
  it('bottom is the thinnest, top the thickest, up thickens', () => {
    expect(sizeAtRail(300, 100, 200, 1, 640)).toBe(1);
    expect(sizeAtRail(100, 100, 200, 1, 640)).toBe(640);
    expect(sizeAtRail(150, 100, 200, 1, 640)).toBeGreaterThan(sizeAtRail(250, 100, 200, 1, 640));
  });

  it('the middle of the rail is the middle of the log track, as on the brush slider', () => {
    expect(sizeAtRail(200, 100, 200, 1, 640)).toBe(sizeAtPosition(SIZE_TRACK / 2, 1, 640));
  });

  it('a finger past either end holds at the end', () => {
    expect(sizeAtRail(-50, 100, 200, 1, 640)).toBe(640);
    expect(sizeAtRail(900, 100, 200, 1, 640)).toBe(1);
  });

  it('a rail with no height yet leaves the size alone at the thin end', () => {
    expect(sizeAtRail(100, 100, 0, 3, 640)).toBe(3);
  });
});

describe('the keys step the rail as they step the brush slider', () => {
  it('Home and End are the ends, the pages a quarter, unknown keys nothing', () => {
    expect(sizeByKey('Home', 20, 1, 640, ux)).toBe(1);
    expect(sizeByKey('End', 20, 1, 640, ux)).toBe(640);
    expect(sizeByKey('PageUp', 20, 1, 640, ux)).toBe(25);
    expect(sizeByKey('PageDown', 20, 1, 640, ux)).toBe(16);
    expect(sizeByKey('a', 20, 1, 640, ux)).toBeNull();
  });

  it('the arrows step as + and − do; up and right thicken', () => {
    expect(sizeByKey('ArrowUp', 20, 1, 640, ux)).toBe(21);
    expect(sizeByKey('ArrowRight', 20, 1, 640, ux)).toBe(21);
    expect(sizeByKey('ArrowDown', 20, 1, 640, ux)).toBe(19);
  });

  it('never leaves the range', () => {
    expect(sizeByKey('PageUp', 640, 1, 640, ux)).toBe(640);
    expect(sizeByKey('PageDown', 1, 1, 640, ux)).toBe(1);
  });

  it('the brush slider uses the same steps, not a copy of them', () => {
    expect(panel).toContain('sizeByKey(');
    expect(panel).not.toContain("e.key === 'PageUp'");
  });
});

describe('the rail on the canvas', () => {
  const rail = canvas.slice(canvas.indexOf('class="size-rail"') - 400, canvas.indexOf('</div>', canvas.indexOf('class="size-rail"')));

  it('is a slider a reader names and a keyboard turns', () => {
    expect(rail).toContain('role="slider"');
    expect(rail).toContain('aria-orientation="vertical"');
    expect(rail).toContain("aria-label={t('brush.sizes_group')}");
    expect(rail).toContain('aria-valuenow={editor.brushSizeLogical}');
    expect(rail).toContain('aria-valuetext=');
    expect(rail).toContain('tabindex="0"');
    expect(rail).toContain('onkeydown={onRailKey}');
    expect(canvas.match(/function onRailKey\([^]*?\n  }/)![0]).toContain('sizeByKey(');
  });

  it('writes through the brush’s own setter, on its log track', () => {
    expect(canvas).toContain('editor.brushSizeLogical = sizeAtRail(');
    expect(canvas).toContain('editor.brushRange.min, editor.brushSizeMax');
  });

  it('shows only for a hand that touches: a coarse pointer or the first finger', () => {
    expect(canvas).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.size-rail/);
    expect(canvas).toContain("e.pointerType === 'touch'");
    expect(canvas).toContain('class:touched={touchSeen}');
    expect(canvas).toMatch(/\.size-rail \{[^}]*display: none/);
  });

  it('is hidden while the film plays: there is nothing to draw', () => {
    expect(canvas).toContain('{#if !editor.playing}');
  });

  it('is a finger wide and turns high contrast', () => {
    expect(canvas).toMatch(/\.size-rail \{[^}]*width: var\(--key-h, 2\.75rem\)/);
    expect(canvas).toMatch(/@media \(forced-colors: active\)\s*\{[^]*\.size-rail/);
  });

  it('shows the ring at the sheet’s scale while held, as Shift+drag does', () => {
    expect(canvas).toContain('railHeld');
    expect(canvas).toMatch(/const ring = \$derived\(/);
    expect(canvas).toContain('style:width="{diameterOf(ring.size)}px"');
  });
});

describe('the hint names the finger’s way too', () => {
  it('mentions the rail beside the canvas', () => {
    expect(t('brush.size_hint')).toContain('ползунком у края холста');
  });
});

// Sanity: the helpers under test sit on the existing track.
it('positionOfSize is still the inverse', () => {
  expect(sizeAtPosition(positionOfSize(42, 1, 640), 1, 640)).toBe(42);
});
