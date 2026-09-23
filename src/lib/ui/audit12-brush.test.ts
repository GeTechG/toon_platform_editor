import { describe, expect, it } from 'bun:test';
import '../../core-plugin';
import type { ToolDescriptor } from '../format/types';
import * as profiles from '../tools/profiles';
import { parseUiConfig } from './presets';

// Twelfth audit, the brush.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

describe('a pen without a pressure sensor', () => {
  // Pointer Events: hardware that cannot sense pressure reports 0.5 while it
  // touches. Every sample at 0.5 was read as a half press, and the line landed
  // at 57.5 % of the width the box said — 9 drew 5.
  const line: ToolDescriptor = { kind: 'pencil', geometry: 'line', width: 100, color: '#123456' };
  const raw: profiles.StrokeRules = { capture: (_line, batch) => batch.slice() };
  const pen = (x: number, pressure?: number): profiles.PointerSample =>
    ({ pointerId: 1, isPrimary: true, x, y: 0, pressure });

  it('draws at the width in the box', () => {
    const session = profiles.beginStrokeSession(pen(0, 0.5), line, raw);
    profiles.appendStrokeEvent(session, pen(50, 0.5));
    profiles.finishStrokeEvent(session, pen(100, 0));
    const stroke = profiles.commitStrokeSession(session);
    expect('pressure' in stroke).toBe(false);
    expect(stroke.tool.kind === 'pencil' && stroke.tool.width).toBe(100);
    expect(profiles.previewStrokePressure(session, stroke.points as number[])).toBeUndefined();
  });

  it('still hears a real pen that passes through a half press', () => {
    const session = profiles.beginStrokeSession(pen(0, 0.5), line, raw);
    profiles.appendStrokeEvent(session, pen(50, 0.8));
    profiles.finishStrokeEvent(session, pen(100, 0));
    expect(profiles.commitStrokeSession(session).pressure?.at(-1)).toBe(80);
  });
});

describe('the brush type across a reload', () => {
  // The type lived only in memory: a reload under Multator opened on
  // «Обычная», and the Multator preset drew the editor's own line instead of
  // its own until the preset was picked again. A type picked by hand was
  // lost the same way.
  const saved = (drawing: Record<string, unknown>) =>
    parseUiConfig(JSON.stringify({ preset: 'multator', drawing }))?.drawing.brushType;

  it("falls back to the preset's own type", () => {
    expect(saved({})).toBe('multator');
    expect(saved({ brushType: 7 })).toBe('multator');
  });

  it('keeps the type picked by hand', () => {
    expect(saved({ brushType: 'normal' })).toBe('normal');
  });

  it('is read on start and written with the rest of the brush', () => {
    expect(state).toMatch(/this\.brushType = saved\.drawing\.brushType/);
    expect(state).toMatch(/brushType: this\.brushType,/);
    expect(panel).toMatch(/editor\.setBrushType\(option\.id\)/);
  });
});

describe('the list of brush types', () => {
  // The box scrolls with the list open, and the list stayed where the button
  // had been, hanging over the sliders.
  it('follows its button when anything scrolls under it', () => {
    expect(panel).toMatch(/<svelte:window .*onscrollcapture=\{\(\) => picking && place\(\)\}/);
  });
});
