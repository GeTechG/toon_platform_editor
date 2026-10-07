import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { budgetLabel } from './format-limit';

describe('the budget in the layer column', () => {
  it('says how full the mult is, as a whole percent', () => {
    const label = budgetLabel(0.376);
    expect(label.text).toMatch(/^37\s%$/);
    expect(label.title).toMatch(/^Мульт заполнен на 37\s%$/);
    expect(label.tight).toBe(false);
  });

  it('rounds toward the truth on both sides of the limit', () => {
    expect(budgetLabel(0.9996).text).toMatch(/^99\s%$/);
    expect(budgetLabel(1).text).toMatch(/^100\s%$/);
    expect(budgetLabel(1).over).toBe(false);
    expect(budgetLabel(1.0004).text).toMatch(/^101\s%$/);
  });

  it('turns tight from 80 %: publishing is close to its limit', () => {
    expect(budgetLabel(0.79).tight).toBe(false);
    const label = budgetLabel(0.8);
    expect(label.tight).toBe(true);
    expect(label.title).toMatch(/^Мульт заполнен на 80\s% — скоро не получится опубликовать$/);
  });

  it('past 100 % it keeps counting and says the mult cannot be published', () => {
    const label = budgetLabel(1.12);
    expect(label.over).toBe(true);
    expect(label.text).toMatch(/^112\s%$/);
    expect(label.title).toMatch(/^Мульт заполнен на 112\s% — больше лимита, опубликовать не получится$/);
  });
});

// EditorState is a runes class, so its part is asserted as source.
describe('a mult heavier than the publish limit', () => {
  const state = readFileSync(new URL('./editor-state.svelte.ts', import.meta.url), 'utf8');

  it('the mult that just went over the limit is told so once, in the canvas line', () => {
    expect(state).toMatch(/if \(!wasOver && this\.budgetShare > 1\) \{\s*this\.canvasHint = \{ text: t\('canvas\.over_budget'\) \};/);
  });

  it('sending a mult over the limit is refused in the studio, before the site is asked', () => {
    const studio = readFileSync(new URL('./Editor.svelte', import.meta.url), 'utf8');
    const send = studio.match(/function sendOut\(\): void \{[^]*?\n {2}\}/)?.[0] ?? '';
    expect(send.indexOf("t('editor.publish_over_budget'")).toBeGreaterThan(0);
    expect(send.indexOf("t('editor.publish_over_budget'")).toBeLessThan(send.indexOf('onPublish?.('));
  });
});

// 2026-10-08 critique: a bare «0 %» beside «+ Слой» is what every drawing
// program writes for a layer's opacity. The weight limits publishing, not
// drawing (owner, 2026-10-06), so the figure stands only where it warns.
describe('the budget figure waits until it matters', () => {
  const rows = readFileSync(new URL('./LayerRows.svelte', import.meta.url), 'utf8');

  it('is drawn from 80 % on, not among the layer controls of an empty mult', () => {
    expect(rows).toMatch(/\{#if budget\.tight\}\s*<span class="budget"[^>]*title=\{budget\.title\}>[^]*?<\/span>\s*\{\/if\}/);
    expect(rows).not.toContain('class:tight={budget.tight}');
  });
});
