import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { PointerStrokeController } from '../tools/profiles';
import { brushPreview } from './brush-preview';
import { defaultBrushOf } from './presets';

// Seventeenth audit, the brush: what a plugin brush may hand the frame, and
// the record its rules are read with.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();

const PLUGIN = 'test.audit17-brush';
afterEach(() => plugins.remove(PLUGIN));

/** A plugin brush with a stroke of its own making. */
function brushWith(stroke: Record<string, unknown>): string {
  plugins.register({
    id: PLUGIN,
    api: PLUGIN_API,
    tools: {
      'test.a17-brush': {
        label: 'Кривая', title: 'Кривая', key: '', icon: '<path />',
        stroke: {
          kind: 'pencil',
          descriptor: ({ width, color }: { width: number; color: string }) =>
            ({ kind: 'pencil', geometry: 'smooth', width, color }),
          ...stroke,
        },
      },
    },
  });
  return 'test.a17-brush';
}

/** One gesture through the engine the canvas runs, with a plugin's commit. */
function commitOf(commit: () => unknown) {
  const tool = brushWith({
    rules: () => ({ capture: (_l: readonly number[], batch: readonly number[]) => [...batch], commit }),
  });
  const stroke = plugins.tool(tool)!.stroke!;
  const brush = { width: 8, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 };
  const pointer = new PointerStrokeController(() => ({
    descriptor: stroke.descriptor(brush), rules: stroke.rules!(brush)!, zoom: 1,
  }));
  const sample = (x: number) => ({ pointerId: 1, isPrimary: true, x, y: 0 });
  pointer.pointerDown(sample(0));
  pointer.pointerMove(sample(80));
  pointer.pointerUp(sample(160));
  return pointer.takeCommitted();
}

describe('кисть плагина не кладёт в кадр то, что формат не откроет', () => {
  // The frame took it, the draft was saved with it, and the draft never opened
  // again: the schema refused the descriptor the in-memory check let through.
  const bad = {
    'перо с заливкой не цветом': { kind: 'feather', geometry: 'smooth', width: 8, color: '#000000', fill: 'white' },
    'штамп с формой за клеткой': { kind: 'stamp', geometry: 'line', width: 8, color: '#000000', shape: [0, 0, 2, 0, 1, 1] },
    'штамп без формы': { kind: 'stamp', geometry: 'line', width: 8, color: '#000000' },
    'карандаш с чужой геометрией': { kind: 'pencil', geometry: 'bezier', width: 8, color: '#000000' },
    'карандаш нулевой толщины': { kind: 'pencil', geometry: 'smooth', width: 0, color: '#000000' },
  };
  for (const [name, tool] of Object.entries(bad)) {
    it(name, () => {
      const error = spyOn(console, 'error').mockImplementation(() => {});
      expect(commitOf(() => ({ points: [0, 0, 80, 0, 160, 0], tool }))).toBeNull();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  }

  it('нажим вне 0–100 — тоже', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const tool = { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' };
    expect(commitOf(() => ({ points: [0, 0, 80, 0, 160, 0], tool, pressure: [0.5, 150, 20] }))).toBeNull();
    error.mockRestore();
  });

  it('годный штрих ложится как прежде', () => {
    const tool = { kind: 'feather', geometry: 'smooth', width: 8, color: '#000000', fill: '#ffffff' };
    expect(commitOf(() => ({ points: [0, 0, 80, 0, 160, 0], tool }))?.points).toEqual([0, 0, 80, 0, 160, 0]);
  });

  // Owner, after the seventeenth audit: a descriptor without a width breaks
  // the plugin, and the line is laid with the canvas's own width.
  it('descriptor без толщины — плагин отключён, линия ложится толщиной холста', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const tool = brushWith({ descriptor: ({ color }: { color: string }) => ({ kind: 'pencil', geometry: 'smooth', color }) });
    const stroke = plugins.tool(tool)!.stroke!;
    const brush = { width: 8, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 };
    const pointer = new PointerStrokeController(() => ({ descriptor: stroke.descriptor(brush), rules: { capture: (_l, b) => [...b] }, zoom: 1 }));
    pointer.pointerDown({ pointerId: 1, isPrimary: true, x: 0, y: 0 });
    pointer.pointerUp({ pointerId: 1, isPrimary: true, x: 80, y: 0 });
    expect(pointer.takeCommitted()?.tool).toMatchObject({ kind: 'pencil', width: 8 });
    expect(plugins.brokenReason(PLUGIN)).toBeDefined();
    plugins.enable(PLUGIN);
    error.mockRestore();
  });
});

describe('образец кисти читает правила той же записью, что и холст', () => {
  it('толщина в правилах — в логических пикселях, как на холсте', () => {
    // The canvas hands `rules()` the record the sliders hold; the sample
    // handed it document units, eight times as wide.
    let seen = 0;
    const tool = brushWith({
      rules: (brush: { width: number }) => {
        seen = brush.width;
        return { capture: (_l: readonly number[], batch: readonly number[]) => [...batch] };
      },
    });
    brushPreview(tool, 'toonop-brush', 4, defaultBrushOf('toonop-brush'));
    expect(seen).toBe(4);
  });
});

describe('образцы в списке типов — того инструмента, что в руке', () => {
  it('не карандаша при ластике или кисти плагина', () => {
    // A type offered for the eraser, or for a plugin's tool, showed the
    // pencil's twin — or the plain pencil when the type has no pencil twin.
    expect(panel).not.toContain("brushOfType('pencil'");
    expect(panel).toContain('brushOfType(editor.tool, current.id)');
    expect(panel).toContain('brushOfType(editor.tool, option.id)');
  });
});

describe('тип кисти плагина под именем «Обычной»', () => {
  it('не встаёт в список вторым «normal»', async () => {
    // The list is keyed by id: two «normal» threw in the brush box, and the
    // everyday type could not be told from the plugin's.
    const { brushTypesFor } = await import('../plugins/brush-types');
    const warn = spyOn(console, 'error').mockImplementation(() => {});
    plugins.register({
      id: PLUGIN,
      api: PLUGIN_API,
      brushTypes: { normal: { label: 'Самозванка', twins: { pencil: 'multator-pencil' } } },
    });
    warn.mockRestore();
    const ids = brushTypesFor('pencil').map(({ id }) => id);
    expect(ids.filter((id) => id === 'normal')).toHaveLength(1);
    expect(plugins.brushType('normal')).toBeUndefined();
  });
});

describe('список типов без popover, выбранный с клавиатуры', () => {
  it('возвращает фокус на кнопку списка, а не в body', () => {
    // Enter on a type hid the list with the focus inside it: Safari 16 left
    // the focus nowhere, and Tab started over from the top of the page.
    const close = panel.slice(panel.indexOf('function close()'), panel.indexOf('function pressedElsewhere'));
    expect(close).toMatch(/list\?\.contains\(document\.activeElement\)/);
    expect(close).toMatch(/trigger\?\.focus\(\)/);
  });
});

describe('список типов слышит, что плагин пришёл или ушёл', () => {
  it('перечитывает реестр по pluginsVersion', () => {
    // The register is no state: a plugin that broke kept its type in the
    // list, and one just installed showed none, until the tool was changed.
    expect(panel).toMatch(/const types = \$derived\.by\(\(\) => \{\s*void editor\.pluginsVersion;/);
    expect(panel).toMatch(/const offered = \$derived\.by\(\(\) => \{\s*void editor\.pluginsVersion;/);
    expect(panel).toContain('{#if offered}');
    expect(panel).toMatch(/if \(!hasBrushTypes\(editor\.tool\)\) picking = false;\s*(\/\/.*\s*)*void editor\.pluginsVersion;/);
  });
});
