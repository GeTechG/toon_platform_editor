import { describe, expect, test } from 'bun:test';

import { PLUGIN_API, type StrokeRules } from './contract';
import { PluginRegistry } from './registry';

/** The smallest manifest the registry accepts — a tool and nothing else. */
function toolPlugin(id: string, patch: Record<string, unknown> = {}): unknown {
  return {
    id,
    api: PLUGIN_API,
    tool: { label: 'Полутон', title: 'Полутон', icon: '<path d="M4 4h16" />', ...patch },
  };
}

describe('PluginRegistry', () => {
  test('a registered tool is there, with its key, icon and labels', () => {
    const registry = new PluginRegistry();

    expect(registry.register(toolPlugin('a.halftone', { key: 'H' }))).toBeNull();

    const tool = registry.tool('a.halftone');
    expect(tool?.label).toBe('Полутон');
    expect(tool?.icon).toBe('<path d="M4 4h16" />');
    expect(tool?.key).toBe('H');
    expect(registry.tools().map((entry) => entry.id)).toEqual(['a.halftone']);
  });

  test('a plugin of an unknown contract major is skipped, the rest are kept', () => {
    const registry = new PluginRegistry();

    registry.register(toolPlugin('a.one'));
    expect(registry.register({ ...toolPlugin('a.future') as object, api: PLUGIN_API + 1 })).toContain('api');

    expect(registry.tools().map((entry) => entry.id)).toEqual(['a.one']);
    expect(registry.failures).toEqual([{ id: 'a.future', reason: 'чужой мажор api: 2' }]);
  });

  test('a manifest without the fields a tool needs is skipped', () => {
    const registry = new PluginRegistry();

    expect(registry.register({ id: 'a.bare', api: PLUGIN_API, tool: { label: 'Без иконки' } })).not.toBeNull();
    expect(registry.register({ api: PLUGIN_API })).not.toBeNull();
    expect(registry.register('не модуль')).not.toBeNull();

    expect(registry.tools()).toEqual([]);
  });

  test('the same id twice: the one loaded first stays', () => {
    const registry = new PluginRegistry();

    registry.register(toolPlugin('a.halftone', { label: 'Первый' }));
    expect(registry.register(toolPlugin('a.halftone', { label: 'Второй' }))).toContain('id');

    expect(registry.tool('a.halftone')?.label).toBe('Первый');
  });

  test('a key already taken: the tool is there, the key is not', () => {
    const registry = new PluginRegistry();
    registry.register(toolPlugin('a.first', { key: 'H' }));

    expect(registry.register(toolPlugin('a.second', { key: 'H' }))).toBeNull();

    expect(registry.tool('a.second')?.key).toBe('');
    expect(registry.tool('a.first')?.key).toBe('H');
    expect(registry.failures).toEqual([{ id: 'a.second', reason: 'клавиша занята: H' }]);
  });

  test('a key the editor keeps for itself is taken too', () => {
    const registry = new PluginRegistry(['Ctrl+S']);

    registry.register(toolPlugin('a.saver', { key: 'ctrl+s' }));

    expect(registry.tool('a.saver')?.key).toBe('');
  });

  test('a tool may only lay down a primitive the format already knows', () => {
    const registry = new PluginRegistry();

    expect(registry.register(toolPlugin('a.blob', { stroke: { kind: 'blob', descriptor: () => null } }))).toContain('примитив');
    expect(registry.register(toolPlugin('a.pixel', { stroke: { kind: 'stamp', grid: true, descriptor: () => null } }))).toBeNull();

    // No dialect in the manifest: the pixel is a pixel of the Tonio canvas
    // because that is what the primitive is, not because a plugin said so.
    expect(registry.tool('a.pixel')?.stroke?.kind).toBe('stamp');
    expect(registry.tool('a.pixel')?.stroke?.grid).toBe(true);
    expect(registry.tool('a.blob')).toBeUndefined();
  });

  test('a key finds the tool that holds it, whatever case it was pressed in', () => {
    const registry = new PluginRegistry(['Ctrl+S']);
    registry.register(toolPlugin('a.halftone', { key: 'H' }));

    expect(registry.toolByKey('h')?.id).toBe('a.halftone');
    expect(registry.toolByKey('H')?.id).toBe('a.halftone');
    expect(registry.toolByKey('Ctrl+S')).toBeUndefined();
    expect(registry.toolByKey('')).toBeUndefined();
  });

  test('taking a plugin off frees its key for the one that comes next', () => {
    const registry = new PluginRegistry();
    registry.register(toolPlugin('pencil', { key: 'B' }), { builtin: true });
    registry.register(toolPlugin('a.halftone', { key: 'H' }));

    registry.remove('a.halftone');

    expect(registry.tools().map((tool) => tool.id)).toEqual(['pencil']);
    expect(registry.register(toolPlugin('a.halftone', { key: 'H' }))).toBeNull();
    expect(registry.tool('a.halftone')?.key).toBe('H');
  });

  test('a brush that commits its own stroke passes like any other', () => {
    const registry = new PluginRegistry();
    const commit = (points: readonly number[]) => ({
      points: [...points],
      tool: { kind: 'contour', geometry: 'smooth', color: '#000000' } as const,
    });

    expect(registry.register(toolPlugin('a.oldschool', {
      stroke: {
        kind: 'pencil',
        descriptor: () => ({ kind: 'pencil', geometry: 'smooth', width: 4, color: '#000000' }),
        rules: (): StrokeRules => ({ canvas: 600, capture: (line, batch) => [...line, ...batch], commit }),
      },
    }))).toBeNull();

    // Not the same function: an external plugin's is wrapped so its throw
    // costs the plugin and not the editor. What it commits is what matters.
    expect(
      registry.tool('a.oldschool')?.stroke?.rules?.()?.commit?.([1, 2], {} as never, { coordinateScale: 1 }),
    ).toEqual(commit([1, 2]));
  });

  test('built-in tools go in the same way external ones do', () => {
    const registry = new PluginRegistry();

    registry.register(toolPlugin('pencil', { key: 'B' }), { builtin: true });

    expect(registry.tool('pencil')?.key).toBe('B');
    expect(registry.tools()[0].builtin).toBe(true);
  });
});

describe('a plugin that throws', () => {
  const broken = (id: string, tool: Record<string, unknown>) => ({
    id,
    api: PLUGIN_API,
    tool: { label: id, title: id, key: '', icon: '<path />', ...tool },
  });

  /** The console is the plugin's error report; the test keeps it out of the run. */
  function quiet<T>(run: () => T): T {
    const original = console.error;
    console.error = () => {};
    try {
      return run();
    } finally {
      console.error = original;
    }
  }

  test('a gesture callback that throws disables the plugin instead of the editor', () => {
    const registry = new PluginRegistry();
    registry.register(broken('a.bad', { move: () => { throw new Error('ой'); } }));

    const tool = registry.tool('a.bad')!;
    quiet(() => tool.move!({} as never, { x: 0, y: 0 }));

    expect(registry.tools().map((t) => t.id)).toEqual([]);
    expect(registry.tool('a.bad')).toBeUndefined();
    expect(registry.brokenReason('a.bad')).toContain('ой');
  });

  test('a descriptor that throws draws as a pencil and the plugin is off', () => {
    const registry = new PluginRegistry();
    registry.register(broken('a.bad', {
      stroke: { kind: 'pencil', descriptor: () => { throw new Error('ой'); } },
    }));

    const stroke = registry.tool('a.bad')!.stroke!;
    const descriptor = quiet(() => stroke.descriptor({ width: 3, color: '#000', fill: '#fff' }));

    expect(descriptor).toEqual({ kind: 'pencil', geometry: 'smooth', width: 3, color: '#000' });
    expect(registry.tool('a.bad')).toBeUndefined();
  });

  test('tells whoever is holding the tool that it broke', () => {
    const registry = new PluginRegistry();
    const told: string[] = [];
    registry.onBreak = (id) => told.push(id);
    registry.register(broken('a.bad', { press: () => { throw new Error('ой'); } }));

    quiet(() => registry.tool('a.bad')!.press!({} as never, { x: 0, y: 0 }));

    expect(told).toEqual(['a.bad']);
  });

  test('comes back when it is switched on again', () => {
    const registry = new PluginRegistry();
    registry.register(broken('a.bad', { release: () => { throw new Error('ой'); } }));
    quiet(() => registry.tool('a.bad')!.release!({} as never));

    registry.enable('a.bad');

    expect(registry.tool('a.bad')).toBeDefined();
    expect(registry.brokenReason('a.bad')).toBeUndefined();
  });

  test('a built-in tool is not wrapped: its throw is the editor\'s bug, not a plugin failure', () => {
    const registry = new PluginRegistry();
    registry.register(broken('pencil', { move: () => { throw new Error('баг'); } }), { builtin: true });

    expect(() => registry.tool('pencil')!.move!({} as never, { x: 0, y: 0 })).toThrow('баг');
    expect(registry.tool('pencil')).toBeDefined();
  });
});
