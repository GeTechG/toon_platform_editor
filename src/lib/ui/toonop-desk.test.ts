import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { panelItems, toolOpensBrush } from './panels';
import { DEFAULT_PRESET, presetPanels, presetUx } from './presets';
import { phoneLayout, phoneTools } from './small-screen';

// The owner, 2026-10-10: «на пк toonop не очень удобен, он повторяет procreate
// dreams, но он для планшетов был» — on a desk toonop stands as desk programs
// do: the tools down the left, the colours open on the right, the film's own
// keys over the canvas. Toonop's own colours, not Toonio's palette box.
void plugins;
const base = presetPanels(DEFAULT_PRESET);

describe('toonop on a desk', () => {
  it('the tools stand down the left, no thickness (owner: «слева толщину нужно убрать из панели»), undo and redo under them (owner: «перенеси undo redo в левую панель»)', () => {
    expect(base.left).toEqual([
      'tool:pencil', 'tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:pipette', 'tool:bucket', 'tool:drag', 'tool:lasso', 'tool:loop', 'history',
    ]);
    expect(base.hidden).toContain('tool:distort');
  });

  it('toonop’s own colours stand open on the right, first; Toonio’s palette box stays on the shelf', () => {
    // The colours alone (owner: the thickness beside them was a leftover once the brush went back behind its key).
    expect(base.right).toEqual(['colours']);
    expect(panelItems().find((item) => item.id === 'colours')?.wide).toBe(true);
    expect(base.hidden).toEqual(expect.arrayContaining(['palette', 'brush', 'brush-key', 'brush-rail', 'color-key']));
  });

  it('the whole brush, its thickness too, is behind its tool’s key (owner: «настройки кисти вернуть в кнопку») — pressed again, or with the right button', async () => {
    expect(toolOpensBrush(base, 'pencil')).toBe(true);
    const popKey = await Bun.file(new URL('./PopKey.svelte', import.meta.url)).text();
    // The right button opens the window whatever the gate says: it has taken the tool in hand by then.
    expect(popKey).toMatch(/oncontextmenu=\{\(e\) => \{\s+e\.preventDefault\(\);\s+gate\?\.\(\);\s+open = true;/);
    const ru = JSON.parse(await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text());
    expect(ru.tool.again_brush).toBe('{{title}}. Ещё одно нажатие или правая кнопка открывает настройки кисти');
  });

  it('no bar over the canvas (owner: «убрать верхнее меню, всё куда-то разложить» — it was mostly empty): its keys stand at the far end of the transport’s row, «Отправить» last', () => {
    expect(base.top).toEqual([]);
    expect(base.rows).toEqual([
      ['fps', 'add-frame', 'transport', 'onion', 'audio', 'spring', 'saved', 'save', 'export', 'settings', 'manual', 'fullscreen', 'publish'],
      ['timeline'],
    ]);
  });

  it('a phone is drawn as it was: the thickness and undo beside the canvas, the colours behind their key', () => {
    const keep = { tools: phoneTools(presetUx(DEFAULT_PRESET)), tall: true, room: 4, drawn: (tool: string) => tool !== 'pipette' };
    const cut = phoneLayout(base, base, keep);
    expect(cut.panels.left).toEqual(['brush-rail', 'history']);
    expect(cut.panels.right).toEqual([]);
    expect(cut.panels.top).toEqual(['publish', 'more', 'spring', 'tool:pencil', 'tool:eraser', 'tools', 'color-key']);
    expect(cut.panels.rows).toEqual([['add-frame', 'transport', 'spring', 'onion', 'audio'], ['timeline']]);
    expect(cut.more.flatMap((group) => group.items)).not.toContain('colours');
  });

  // The owner, 2026-10-12: «на пк видно левую панель а под ней панель толщины»,
  // «иконки разного размера» — a desk under a finger (a tablet is a desk).
  it('a finger’s thickness rail stands beside the left column, not under its card', async () => {
    const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url).pathname).text();
    // The canvas runs on under the column by `--stage-left`: the rail counts it.
    expect(canvas).toMatch(/\n  \.size-rail \{[^}]*left: calc\(var\(--stage-left, 0px\) \+ 1\.25rem\)/);
  });

  it('on a low desk every tool key keeps its size — the ones that open a window too (PopKey is `display: contents`: its key is the column’s flex item)', async () => {
    const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();
    expect(editorUi).toMatch(/\.left\.sidebar:not\(\.lies\) > :global\(\*\),\s*\.studio:not\(\.compact\) \.left\.sidebar:not\(\.lies\) > :global\(\.pop-key > \*\) \{\s*flex: none;/);
  });

  it('a desk has no thickness rail on the stage, under a finger either (owner, 2026-10-12: «настройку толщины мы вроде убрали с пк») — the thickness is behind the brush’s key', async () => {
    const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url).pathname).text();
    expect(editorUi).toMatch(/const stageRail = \$derived\(\s*compact &&/);
  });
});
