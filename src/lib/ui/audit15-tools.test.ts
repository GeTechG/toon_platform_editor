import { describe, expect, it } from 'bun:test';
import { FIXED_POINT_SCALE } from '../format/constants';
import { PLUGIN_API } from '../plugins/contract';
import { PluginRegistry } from '../plugins/registry';
import { RESERVED_KEYS } from '../plugins/builtins';
import { EMPTY_TRANSFORM, nudged } from '../tools/lasso';

// Fifteenth audit, tools: a plugin key that took Tab away, arrows that moved a
// selection an eighth of a pixel, the transform window that dropped the focus
// on the page and kept an emptied field empty, and a cut or a merge of nothing
// that filed a step of undo and threw the redo away.
// The store and the windows are runes components, so they are asserted as
// source, like audit14.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const menu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();
const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

function toolPlugin(id: string, key: string): unknown {
  return {
    id,
    api: PLUGIN_API,
    tools: { [id]: { label: 'Полутон', title: 'Полутон', icon: '<path d="M4 4h16" />', key } },
  };
}

describe('a plugin key is one key the editor can hand over', () => {
  it('Tab, a function key or a paging key is refused, the tool stays', () => {
    // A tool that asked for Tab got it: the window listener picked the tool and
    // prevented the default, so Tab no longer left the canvas (WCAG 2.1.2).
    for (const key of ['Tab', 'F5', 'PageDown', 'Home', 'Alt+G', 'Ctrl+G', 'ж']) {
      const registry = new PluginRegistry(RESERVED_KEYS);
      registry.register(toolPlugin('a.tool', key));
      expect(registry.tool('a.tool')?.key).toBe('');
      expect(registry.toolByKey(key)).toBeUndefined();
      expect(registry.failures.length).toBe(1);
    }
  });

  it('a single printable key still works', () => {
    const registry = new PluginRegistry(RESERVED_KEYS);
    registry.register(toolPlugin('a.tool', 'G'));
    expect(registry.tool('a.tool')?.key).toBe('G');
    expect(registry.toolByKey('g')?.id).toBe('a.tool');
  });

  it('a built-in tool keeps its chord', () => {
    const registry = new PluginRegistry(RESERVED_KEYS);
    registry.register(toolPlugin('mega', 'Alt+E'), { builtin: true });
    expect(registry.tool('mega')?.key).toBe('Alt+E');
  });
});

describe('a transform moves in the pixels the brush is measured in', () => {
  it('an arrow moves the selection a pixel, Shift ten', () => {
    // The step was one document unit — an eighth of a pixel, nothing on screen.
    expect(nudged(EMPTY_TRANSFORM, 'move', 1, false).dx).toBe(FIXED_POINT_SCALE);
    expect(nudged(EMPTY_TRANSFORM, 'move', -1, true, 'y').dy).toBe(-10 * FIXED_POINT_SCALE);
  });

  it('the X and Y fields read and write pixels', () => {
    expect(menu).toContain('Math.round(session.dx / FIXED_POINT_SCALE)');
    expect(menu).toContain('Math.round(session.dy / FIXED_POINT_SCALE)');
    expect(menu).toContain("set('dx', e.currentTarget.valueAsNumber * FIXED_POINT_SCALE)");
    expect(menu).toContain("set('dy', e.currentTarget.valueAsNumber * FIXED_POINT_SCALE)");
  });
});

describe('the transform window', () => {
  it('an emptied field shows the value again once it is left', () => {
    // The empty field wrote nothing and stayed empty, though the selection
    // kept its number.
    expect(menu).toMatch(/onchange=\{[^}]*restore/);
    expect(menu).toContain('function restore(');
  });

  it('closed from inside, it hands the focus to the tool in hand, not the page', () => {
    // Apply, cancel or Esc from its fields unmounted the focused control and
    // the focus fell to <body>: the next Tab started from the top.
    expect(menu).toContain('{@attach keepFocus}');
    expect(menu).toMatch(/function keepFocus\([^]*data-tool/);
    expect(toolKey).toContain('data-tool={tool}');
  });
});

describe('a cut or a merge that changes nothing files no step of undo', () => {
  it('the edit is dropped and the cells keep their identity', () => {
    // Ctrl+X on empty cells, or M twice, pushed a step that undid nothing
    // and cleared the redo stack.
    const push = method('pushEdit');
    expect(push).toContain('sameStrokes(');
    expect(push.indexOf('sameStrokes(')).toBeLessThan(push.indexOf('this.undone = []'));
    expect(push).toContain('snapshot.cell');
  });
});
