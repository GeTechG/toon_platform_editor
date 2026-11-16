import { describe, expect, it } from 'bun:test';

import { buildKeymap, studioCommands } from './keymap';
import { allPlaced, toolKeyList, toolOrder } from './panels';
import { plugins } from '../plugins';
import { DEFAULT_PRESET, presetPanels, presetUx } from './presets';

// The owner, 2026-11-16: «добавить в студию инструменты с базовыми фигурами» —
// one key, on the shelf behind «+», as the bucket.
describe('the shapes tool', () => {
  it('is on the T key, offered by toonop, and waits on the shelf', () => {
    expect(plugins.tool('shapes')).toMatchObject({ key: 'T', icon: 'shapes' });
    expect(presetUx(DEFAULT_PRESET).tools).toContain('shapes');
    expect(allPlaced({ ...presetPanels(DEFAULT_PRESET), float: [], hidden: [] })).not.toContain('tool:shapes');
    const keys = buildKeymap(studioCommands(toolOrder().map((id) => ({ id, keys: toolKeyList(id) }))), {});
    expect(keys.resolve('t')).toBe('tool:shapes');
  });
});
