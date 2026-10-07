import { describe, expect, it } from 'bun:test';
import { PRESETS } from '../../core-plugin/presets';
import { TOONOP_UX } from './ux-profile';

const editorSrc = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('toonop\'s transport is Play and a step either side', () => {
  it('the profile says so; Toonio keeps the whole transport, Multator Play alone', () => {
    expect(TOONOP_UX.transport).toBe('steps');
    expect(PRESETS.toonio.ux.transport).toBeUndefined();
    // The owner, 2026-10-06: «убери перемотку кадров, оставь только play».
    expect(PRESETS.multator.ux.transport).toBe('play');
  });

  it('the steps wait for a profile that has them, on the bar', () => {
    expect(editorSrc.match(/\{#if stepKeys\}/g)?.length).toBe(2);
  });

  it('only the first and the last keys wait for the whole transport', () => {
    expect(editorSrc.match(/\{#if endKeys\}/g)?.length).toBe(2);
    for (const key of ['first_frame', 'last_frame']) {
      const at = editorSrc.indexOf(`aria-label={t('editor.${key}')}`);
      const before = editorSrc.lastIndexOf('{#if endKeys}', at);
      expect(editorSrc.slice(before, at)).not.toContain('{/if}');
    }
  });

  it('the timeline is the grid, layers in its column, for every preset', () => {
    // The strip of frames with the layers behind a key was tried and taken
    // back (owner, 2026-10-05: «это не удобно»).
    expect('timeline' in TOONOP_UX).toBe(false);
  });
});
