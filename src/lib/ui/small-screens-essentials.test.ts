import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { defaultPanels, toolItem } from './panels';
import { presetPanels, presetUx } from './presets';
import { DEFAULT_TAB_ORDER, compactLayout, phoneTools } from './small-screen';

// The owner: «убери с левой [колонки] неосновные инструменты, оставим только
// важные». A phone's column keeps the essentials; the rest goes to «⋯». The cut
// runs for real; the studio's call is asserted as source.
void plugins;
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const more = (cut: ReturnType<typeof compactLayout>) => cut.tabs.find((tab) => tab.id === 'more')?.items ?? [];

describe('the essentials of a preset', () => {
  it('Toonop and Toonio: the pencil, the eraser, the lasso — the pipette sits by the palette', () => {
    expect(phoneTools(presetUx('toonop'))).toEqual(['pencil', 'eraser', 'lasso']);
    expect(phoneTools(presetUx('toonio'))).toEqual(['pencil', 'eraser', 'lasso']);
  });

  it('Multator keeps its reference three: its pipette is a key of the tools', () => {
    expect(phoneTools(presetUx('multator'))).toEqual(['pencil', 'eraser', 'lasso', 'pipette']);
  });
});

describe('a phone’s column holds only the essentials', () => {
  const keep = phoneTools(presetUx('toonop'));

  it('the tools that matter and the history; publish at the foot', () => {
    const cut = compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER, { tools: keep, active: 'pencil' });
    expect(cut.rail).toEqual([toolItem('pencil'), toolItem('eraser'), toolItem('lasso'), 'history']);
    expect(cut.foot).toEqual(['publish']);
  });

  it('the rest stays reachable behind «⋯»', () => {
    const items = more(compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER, { tools: keep, active: 'pencil' }));
    for (const id of ['save', 'export', 'fullscreen', 'manual', 'feather', 'mega-eraser', 'drag', 'distort']) {
      expect(items).toContain(toolOfOrItem(id));
    }
    expect(items).not.toContain(toolItem('pencil'));
  });

  it('a tool picked from «⋯» shows in the column in its place, and stays in «⋯»', () => {
    const cut = compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER, { tools: keep, active: 'mega-eraser' });
    expect(cut.rail).toEqual([toolItem('pencil'), toolItem('eraser'), toolItem('mega-eraser'), toolItem('lasso'), 'history']);
    expect(more(cut)).toContain(toolItem('mega-eraser'));
  });

  it('Multator: pencil, eraser, pipette — its history is on the shelf', () => {
    const cut = compactLayout(presetPanels('multator'), 'phone', DEFAULT_TAB_ORDER, {
      tools: phoneTools(presetUx('multator')),
      active: 'pencil',
    });
    expect(cut.rail).toEqual([toolItem('pencil'), toolItem('eraser'), toolItem('pipette')]);
  });

  it('the tablet is untouched: the desktop’s whole left column', () => {
    const layout = defaultPanels();
    const cut = compactLayout(layout, 'tablet', DEFAULT_TAB_ORDER, { tools: keep, active: 'pencil' });
    expect(cut.rail).toEqual(layout.left.filter((id) => id !== 'publish'));
  });

  it('the studio hands the cut the preset’s essentials and the tool in hand', () => {
    expect(editorUi.includes('{ tools: phoneTools(editor.ux), active: editor.tool }')).toBe(true);
  });
});

function toolOfOrItem(id: string): string {
  return ['save', 'export', 'fullscreen', 'manual'].includes(id) ? id : toolItem(id);
}
