import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

/**
 * The state, the canvas and the brush box are runes and Svelte, so their share
 * of the brush's opacity and of the pressure switch is asserted on the source,
 * the way the rest of their contract is (see `pen-pressure.test.ts`).
 */
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const box = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();

describe('the brush box sets the opacity', () => {
  it('with a slider of percents, only for a brush that paints', () => {
    expect(box).toMatch(/\{#if editor\.brushPaints\}[^]*?t\('brush\.opacity'\)[^]*?editor\.setBrushOpacity\(v\)[^]*?\{\/if\}/);
    expect(t('brush.opacity')).toBe('Непрозрачность');
    expect(t('brush.opacity_hint')).not.toStartWith('brush.');
  });

  it('the brush keeps it whole and inside 1–100', () => {
    const setter = state.match(/setBrushOpacity\(value: number\)[^]*?\n {2}}/)?.[0] ?? '';
    expect(setter).toContain('Math.min(100, Math.max(1, Math.round(value)))');
  });

  it('the stroke is begun at it, whichever tool builds the descriptor', () => {
    const descriptor = canvas.match(/function activeDescriptor[^]*?\n {2}}/)?.[0] ?? '';
    expect(descriptor).toContain('withOpacity(');
    expect(descriptor).toContain('editor.brushOpacity');
  });

  it('the line under the hand is as faint as the one that lands', () => {
    const preview = canvas.match(/function renderSessionPreview[^]*?\n {2}}/)?.[0] ?? '';
    expect(preview).toContain('target.globalAlpha');
    // Drawn whole in one pass: a line added to part by part would darken at
    // every join.
    expect(canvas).toMatch(/const grows = [^;]*opacity === undefined/);
  });
});

describe('the pressure switch lives in the brush box', () => {
  it('one switch for every brush, written to the same setting', () => {
    expect(box).toMatch(/role="switch"[^]*?checked=\{editor\.settings\.penPressure\}[^]*?setSetting\('penPressure'/);
    expect(t('brush.pen_pressure')).toBe('Нажим пера');
  });

  it('and has left the settings sheet', () => {
    expect(sheet).not.toContain('penPressure');
    expect(t('settings.pen_pressure')).toBe('settings.pen_pressure');
  });
});
