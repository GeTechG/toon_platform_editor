import { describe, expect, it } from 'bun:test';
import { TOONOP_UX } from './ux-profile';

// The owner, 2026-10-15: «давай сделаем смену кадров в секунду более
// компактным, например сделаем её как текст, нажимая на неё появляется
// всплывающий ползунок» — toonop's only; Toonio and Multator keep the
// reference's slider and box on the bar.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('the frame rate as a word on the bar (toonop)', () => {
  it('toonop asks for it; a profile that says nothing keeps the pair', () => {
    expect(TOONOP_UX.fpsKey).toBe(true);
  });

  it('the key wears the rate and opens a slider under it', () => {
    const branch = editorUi.slice(editorUi.indexOf("{:else if id === 'fps'"), editorUi.indexOf("{:else if id === 'audio'}"));
    expect(branch).toMatch(/editor\.ux\.fpsKey/);
    const pop = branch.slice(branch.indexOf('<PopKey'), branch.indexOf('</PopKey>'));
    expect(pop).toContain('editor.doc.frame_rate');
    expect(pop).toMatch(/<input\s+type="range"[^>]*aria-label=\{t\('editor\.fps'\)\}/);
  });
});
