import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { brushPreview } from './brush-preview';
import ru from '../i18n/ru.json';

// Owner answers after the seventeenth audit, the brush: the number is heard
// from the slider alone, the sample follows the register, and a descriptor
// without a width is a broken plugin.
const sizes = await Bun.file(new URL('./BrushSizes.svelte', import.meta.url)).text();
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

const PLUGIN = 'test.owner17-brush';
afterEach(() => {
  plugins.enable(PLUGIN);
  plugins.remove(PLUGIN);
});

describe('толщину произносит только ползунок', () => {
  it('у счётчика толщины нет role=status', () => {
    expect(sizes).not.toContain('role="status"');
  });

  it('числовое поле подписано «…, число»', () => {
    expect(ru.brush.number_of).toBe('{{label}}, число');
    expect(panel).toMatch(/type="number"[\s\S]*?aria-label=\{t\('brush\.number_of', \{ label \}\)\}/);
  });
});

describe('живой образец слышит реестр', () => {
  it('brushTool и brushRules перечитываются по pluginsVersion', () => {
    expect(state).toMatch(/get brushTool\(\): Tool \{[^}]*void this\.pluginsVersion;/);
    expect(state).toMatch(/get brushRules\(\): StrokeRules \{[^}]*void this\.pluginsVersion;/);
  });
});

describe('descriptor без числовой толщины ломает плагин', () => {
  it('образец рисуется толщиной холста, плагин отключён', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    plugins.register({
      id: PLUGIN,
      api: PLUGIN_API,
      tools: {
        'test.o17-brush': {
          label: 'Без толщины', title: 'Без толщины', key: '', icon: '<path />',
          stroke: {
            kind: 'pencil',
            descriptor: ({ color }: { color: string }) => ({ kind: 'pencil', geometry: 'smooth', color }),
          },
        },
      },
    } as never);
    const shape = brushPreview('test.o17-brush', 'pencil', 4, { width: 4, smooth: 1, minDistance: 0 });
    error.mockRestore();
    expect(Number.isFinite(shape.width)).toBe(true);
    expect(shape.width).toBeGreaterThan(0);
    expect(plugins.brokenReason(PLUGIN)).toBeDefined();
  });
});
