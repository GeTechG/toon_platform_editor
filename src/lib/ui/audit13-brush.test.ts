import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// Thirteenth audit, the brush.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('a slider move that changes nothing writes nothing', () => {
  // The rail follows a finger at the pen's rate, and at the thin end a size
  // spans some twenty pixels of it: every move in between wrote the same
  // record anew — a fresh `byTool` that every sample, cursor and preview
  // re-read, and a synchronous localStorage write, dozens a second.
  const edit = member(state, 'private editBrush');

  it('leaves the record alone when every number is what the brush already reads', () => {
    expect(edit).toMatch(/every\(\(\[key, v\]\) => this\.brush\[key as keyof BrushRecord\] === v\)\) return;/);
  });

  // The record keeps a width grown under a wider preset (brush-ceiling): what
  // is read is held to this preset's ceiling. Moving the smoothing wrote the
  // read width back, and 640 became 500 for good.
  it('writes over the stored record, not over the width capped for reading', () => {
    expect(edit).toMatch(/\.\.\.\(this\.byTool\[tool\] \?\? this\.brush\), \.\.\.patch/);
    expect(edit).not.toMatch(/\{ \.\.\.this\.brush, \.\.\.patch \}/);
  });
});

describe('the thickness help, where a finger reads it', () => {
  // On a phone the brush tab is the only place the box's «i» is read, and it
  // spoke only of Shift — a key a phone has not got.
  it('names the rail beside the canvas as well as Shift', () => {
    expect(t('brush.thickness_hint')).toContain('Shift');
    expect(t('brush.thickness_hint')).toContain('ползунком у края холста');
  });
});
