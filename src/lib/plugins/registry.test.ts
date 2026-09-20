import { describe, expect, test } from 'bun:test';

import { PLUGIN_API } from './contract';
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

  test('rereading the address drops what came from it, and nothing else', () => {
    const registry = new PluginRegistry();
    registry.register(toolPlugin('pencil', { key: 'B' }), { builtin: true });
    registry.register(toolPlugin('a.halftone', { key: 'H' }));
    registry.fail('a.broken', 'сеть');

    registry.resetExternal();

    expect(registry.tools().map((tool) => tool.id)).toEqual(['pencil']);
    expect(registry.failures).toEqual([]);
    // The key it held is free again, so a reread can take it back.
    expect(registry.register(toolPlugin('a.halftone', { key: 'H' }))).toBeNull();
    expect(registry.tool('a.halftone')?.key).toBe('H');
  });

  test('built-in tools go in the same way external ones do', () => {
    const registry = new PluginRegistry();

    registry.register(toolPlugin('pencil', { key: 'B' }), { builtin: true });

    expect(registry.tool('pencil')?.key).toBe('B');
    expect(registry.tools()[0].builtin).toBe(true);
  });
});
