import { describe, expect, it } from 'bun:test';

// Owner answers after the seventeenth audit, the canvas: the thickness rail
// stays through the preview, a held finger takes only the colour, the brush
// ring and the pipette swatch stand down while the film plays, the pipette
// reads inside the composer's buffers, the hint keeps off the zoom window.
// CanvasView and Editor are runes components, so what they must do is
// asserted on their source.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const editorView = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

function railTag(): string {
  const at = source.indexOf('class="size-rail"');
  return source.slice(source.lastIndexOf('<div', at), source.indexOf('>', source.indexOf('onblur=', at)));
}

describe('рейка толщины при просмотре остаётся, как ползунок fps', () => {
  it('не уходит из дерева: фокус на ней не падает на body', () => {
    const at = source.indexOf('class="size-rail"');
    const before = source.slice(source.lastIndexOf('{/if}', at), at);
    expect(before).not.toContain('{#if !editor.playing}');
  });

  it('при просмотре — aria-disabled и приглушена', () => {
    expect(railTag()).toContain('aria-disabled={editor.playing || undefined}');
    expect(source).toMatch(/\.size-rail\[aria-disabled='true'\] \{[^}]*opacity/);
  });

  it('палец и клавиши на ней при просмотре ничего не меняют', () => {
    const down = handler('onRailDown');
    expect(down).toMatch(/if \(editor\.playing[^)]*\) return;/);
    expect(down.indexOf('editor.playing')).toBeLessThan(down.indexOf('railTo('));
    const key = handler('onRailKey');
    expect(key).toMatch(/if \(editor\.playing[^)]*\) return;/);
    expect(key.indexOf('editor.playing')).toBeLessThan(key.indexOf('editor.brushSizeLogical ='));
  });
});

describe('палец-пипетка меняет только цвет', () => {
  it('ластик в руке остаётся: пипетка пальца просит оставить инструмент', () => {
    const finish = handler('finishDropper');
    expect(finish).toContain("editor.pickColor(picked, 'outline', false, true)");
  });

  it('pickColor меняет ластик на карандаш только когда инструмент не просили оставить', () => {
    const pick = state.match(/  pickColor\(color: string[^]*?\n  }/)![0];
    expect(pick).toMatch(/keepTool = false/);
    expect(pick).toMatch(/!keepTool && \(this\.tool === 'eraser' \|\| this\.tool === 'mega-eraser'\)/);
  });

  it('обычная пипетка по-прежнему меняет ластик на карандаш', () => {
    expect(handler('takeColour')).toContain("editor.pickColor(picked, toFill ? 'fill' : 'outline');");
  });
});

describe('при просмотре холст не обещает нажатия', () => {
  it('кольцо кисти и образец пипетки прячутся, пока фильм идёт', () => {
    expect(source).toMatch(/\{#if cursorVisible && !editor\.playing && editor\.tool === 'pipette' && pickPreview\}/);
    expect(source).toMatch(/\{#if cursorVisible && !editor\.playing && editor\.tool !== 'pipette'/);
  });

  it('мыши — обычный системный курсор', () => {
    expect(source).toMatch(/class:custom-cursor=\{!editor\.playing && editor\.tool !== 'pipette' && !overlayCursor\}/);
    expect(source).toMatch(/class:playing=\{editor\.playing\}/);
    expect(source).toMatch(/canvas\.playing \{\s*cursor: default;/);
  });
});

describe('пипетка читает внутри буфера композитора', () => {
  it('координата ограничена размером слоёв, а не холста', () => {
    const pick = handler('pickColor');
    expect(pick).toContain('const read = layers.active as HTMLCanvasElement;');
    expect(pick).toContain('read.width - 1');
    expect(pick).toContain('read.height - 1');
    expect(pick).not.toContain('canvasEl.width - 1');
  });
});

describe('подсказка холста не ложится на окно зума', () => {
  it('сцена на десктопе — контейнер по ширине', () => {
    expect(editorView).toMatch(/\.studio:not\(\.compact\) \.stage \{\s*container: stage \/ inline-size;/);
  });

  it('широкая сцена: подсказка уже, чем промежуток между окнами зума', () => {
    expect(editorView).toMatch(/\.studio:not\(\.compact\) \.stage :global\(\.hint\) \{\s*max-width: calc\(100% - 2 \* /);
  });

  it('узкая сцена: подсказка поднимается над рядом зума', () => {
    const at = editorView.indexOf('@container stage');
    expect(at).toBeGreaterThan(-1);
    const block = editorView.slice(at, editorView.indexOf('}\n  }', at));
    expect(block).toContain(':global(.hint)');
    expect(block).toMatch(/bottom: calc\([^;]*var\(--key-h, 2\.75rem\)/);
  });
});
