import { afterEach, describe, expect, it } from 'bun:test';

import { GifStream, type RgbaFrame } from '../export/gif';
import { layTrack } from '../export/video';
import { VIDEO_BITRATE, selectVideoTarget } from '../export/video-codecs';
import { EXPORT_WIDTHS } from '../format/constants';
import { PLUGIN_API } from '../plugins/contract';
import { PluginRegistry } from '../plugins/registry';
import { loadInstalled } from '../plugins/install';
import { putInstalled, type InstalledPlugin } from '../plugins/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Четырнадцатый аудит, листы, экспорт и плагины.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

/** Глобальная палитра GIF: сразу за логическим экраном, размер — в его флагах. */
function globalPalette(bytes: Uint8Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  const size = 2 ** ((bytes[10] & 7) + 1);
  for (let i = 0; i < size; i++) {
    const at = 13 + i * 3;
    out.push([bytes[at], bytes[at + 1], bytes[at + 2]]);
  }
  return out;
}

describe('GIF: палитра видит весь кадр', () => {
  it('182 кадра по 640 px — палитра не собирается из одного левого столбца', () => {
    const width = 640;
    const height = 360;
    // Белый лист, красная полоса в середине; левый столбец чисто белый.
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const red = x >= 200 && x < 440;
      data[i * 4] = 255;
      data[i * 4 + 1] = red ? 0 : 255;
      data[i * 4 + 2] = red ? 0 : 255;
      data[i * 4 + 3] = 255;
    }
    const frame: RgbaFrame = { data, width, height };
    const frames = 182;
    const stream = new GifStream({ fps: 12, totalPixels: frames * width * height });
    for (let i = 0; i < frames; i++) {
      stream.sample(frame);
    }
    stream.begin();
    stream.write(frame);
    const palette = globalPalette(stream.finish());
    const hasRed = palette.some(([r, g, b]) => r > 200 && g < 60 && b < 60);
    expect(hasRed).toBe(true);
  });
});

describe('видео: привязанный трек не повторяется', () => {
  it('привязанный короткий трек звучит один раз, дальше тишина — как в просмотре', () => {
    const source = Float32Array.from([1, 2, 3]);
    const out = new Float32Array(7);
    layTrack(source, out, false);
    expect([...out]).toEqual([1, 2, 3, 0, 0, 0, 0]);
  });

  it('непривязанный трек повторяется, пока идёт мульт', () => {
    const source = Float32Array.from([1, 2, 3]);
    const out = new Float32Array(7);
    layTrack(source, out, true);
    expect([...out]).toEqual([1, 2, 3, 1, 2, 3, 1]);
  });

  it('WebCodecs кладёт трек с повтором только без привязки', async () => {
    const video = await source('../export/video.ts');
    expect(video).toContain('buildSoundtrack(audio, total / fps, trackSeconds !== undefined)');
  });

  it('запись в реальном времени повторяет непривязанный трек, привязанный — нет', async () => {
    const video = await source('../export/video.ts');
    expect(video).toContain('audioElement.loop = trackSeconds !== undefined');
  });
});

describe('видео: опрос кодека тот же, что и запись', () => {
  const mediabunny = import(
    new URL('../../../node_modules/mediabunny/dist/modules/src/codec.js', import.meta.url).href
  ) as Promise<{ buildVideoCodecString(codec: string, w: number, h: number, bitrate: number): string }>;

  for (const width of EXPORT_WIDTHS) {
    it(`${width} px: спрашиваем кодировщик о той строке кодека, которой mediabunny будет писать`, async () => {
      const { buildVideoCodecString } = await mediabunny;
      const height = Math.round((width * 9) / 16 / 2) * 2;
      const asked: string[] = [];
      await selectVideoTarget({
        hasAudio: false,
        width,
        height,
        probeVideo: async ({ codec }) => {
          asked.push(codec);
          return false;
        },
      });
      expect(asked).toEqual([
        buildVideoCodecString('avc', width, height, VIDEO_BITRATE),
        buildVideoCodecString('vp9', width, height, VIDEO_BITRATE),
        'vp8',
      ]);
    });
  }
});

describe('формат экспорта из плагина', () => {
  it('формат, который не слышит «Отменить» и не отвечает, не вешает лист: отмена завершает его', async () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'a.hang',
      api: PLUGIN_API,
      exporters: { 'a.hang': { label: 'Вечный', run: () => new Promise(() => {}) } },
    });
    const format = registry.exporters()[0];
    const controller = new AbortController();
    const running = format.run({} as never, controller.signal);
    controller.abort();
    const error = await Promise.resolve(running).catch((err: { name?: string }) => err);
    expect((error as { name?: string }).name).toBe('AbortError');
    // Отмена — не сбой: плагин остаётся включённым.
    expect(registry.exporters()).toHaveLength(1);
  });
});

describe('настройки', () => {
  it('наборы переносятся на новую строку, а не режут «Мультатор» посреди слова при 200 %', async () => {
    const sheet = await source('./SettingsSheet.svelte');
    const presets = sheet.slice(sheet.indexOf('.presets {'), sheet.indexOf('}', sheet.indexOf('.presets {')));
    expect(presets).toContain('flex-wrap: wrap');
    const chip = sheet.slice(sheet.indexOf('.preset-chip {'), sheet.indexOf('}', sheet.indexOf('.preset-chip {')));
    expect(chip).not.toMatch(/\n\s*height:/);
    expect(chip).toContain('min-height: var(--key-h)');
    expect(chip).toContain('overflow-wrap: normal');
  });
});

describe('каталог: одна и та же запись дважды', () => {
  it('повтор id не доходит до окна — ключевой список Svelte падал на дубле и ронял окно плагинов', async () => {
    const { readCatalog } = await import('../plugins/catalog');
    const record = { id: 'a.dup', entry: 'a.js', version: '1.0.0', name: 'Дубль' };
    const read = await readCatalog('https://example.test/', {
      fetch: async () => ({
        ok: true,
        json: async () => ({ api: PLUGIN_API, plugins: [record, { ...record, version: '2.0.0' }] }),
      }),
    });
    expect(read.plugins.map((entry) => entry.id)).toEqual(['a.dup']);
    expect(read.plugins[0].version).toBe('1.0.0');
  });
});

describe('плагины: окно', () => {
  it('пока один плагин качается, остальные «Установить» ждут — второй клик не качал его же ещё раз', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    expect(sheet).toContain("disabled={busy !== ''} onclick={() => void askInstall(entry)}");
  });
});

describe('настройки: черновики и «Сохранить сейчас»', () => {
  it('файл черновиков, который не читается, так и называется — а не «хранилище не приняло»', async () => {
    const sheet = await source('./SettingsSheet.svelte');
    const handler = sheet.slice(sheet.indexOf('async function onDraftFile'), sheet.indexOf('function wipePalettes'));
    expect(handler).toContain("t('settings.drafts_unreadable')");
    const { t } = await import('../i18n');
    expect(t('settings.drafts_unreadable')).toBe('Файл черновиков не читается — выбери его ещё раз');
  });

  it('«Сохранить сейчас» отвечает в строке листа: статус студии под листом не виден и не слышен', async () => {
    const sheet = await source('./SettingsSheet.svelte');
    expect(sheet).toContain('onSaveNow?: () => Promise<boolean>');
    expect(sheet).toContain("t(saved ? 'settings.saved_now' : 'settings.save_not_done')");
    const editor = await source('./Editor.svelte');
    expect(editor).toContain('onSaveNow={() => saveNow(true).then((ok) => ok && !storageBlocked)}');
    const { t } = await import('../i18n');
    expect(t('settings.saved_now')).toBe('Черновик сохранён');
    expect(t('settings.save_not_done')).toBe('Черновик не сохранился на этом устройстве');
  });
});

describe('плагин, который не запускается до конца', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  const stored = (id: string, name: string): InstalledPlugin => ({
    id,
    name,
    version: '1.0.0',
    description: '',
    icon: '',
    code: id,
    source: 'catalog',
    installed: 1,
  });

  it('модуль, который вечно ждёт на верхнем уровне, не держит остальные плагины и студию', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(stored('a.hang', 'А'));
    await putInstalled(stored('b.fine', 'Б'));
    const registry = new PluginRegistry();
    const warn = console.warn;
    console.warn = () => {};
    try {
      await loadInstalled(registry, {
        fetch: async () => ({ text: async () => '' }),
        evaluateTimeout: 20,
        evaluate: (code) =>
          code === 'a.hang'
            ? new Promise(() => {})
            : Promise.resolve({
                default: { id: code, api: PLUGIN_API, tools: { [code]: { label: code, title: code, key: '', icon: '<path />' } } },
              }),
      });
    } finally {
      console.warn = warn;
    }
    expect(registry.tools().map((tool) => tool.id)).toContain('b.fine');
    expect(registry.failures.map((failure) => failure.id)).toContain('a.hang');
  });
});

describe('экспорт: формат плагина', () => {
  it('строка о том, что пишет формат, видна под выбором — title не видят палец и читалка', async () => {
    const sheet = await source('./ExportSheet.svelte');
    expect(sheet).toContain('{#if pluginFormat?.hint}');
    expect(sheet).toContain('<p class="note">{pluginFormat.hint}</p>');
  });
});

describe('плагины: строка списка при 200 % текста на телефоне', () => {
  it('клавиши строки уходят на новую строку целиком, а не рвут «Включить» по буквам в клавише высотой в палец', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    const rule = (selector: string) => {
      const at = sheet.indexOf(`${selector} {`);
      return sheet.slice(at, sheet.indexOf('}', at));
    };
    expect(rule('.plugins li')).toContain('flex-wrap: wrap');
    expect(rule('.plugins li > .key')).toContain('flex: none');
    expect(rule('.plugins li > .key')).toContain('overflow-wrap: normal');
    expect(rule('.about')).toContain('flex: 1 1 5rem');
  });
});

describe('окно масштаба', () => {
  it('«Отдалить» на пределе не роняет фокус на страницу: клавиша остаётся в фокусе и говорит, что недоступна', async () => {
    const menu = await source('./ScaleMenu.svelte');
    expect(menu).not.toMatch(/\sdisabled=\{/);
    expect(menu).toContain('aria-disabled={atMin}');
    expect(menu).toContain('aria-disabled={atMax}');
    expect(menu).toContain("button[aria-disabled='true']");
  });
});

describe('настройки: ползунок «Цветов в палитре»', () => {
  it('движение пишет конфиг студии в хранилище один раз, на отпускании, а не на каждом шаге', async () => {
    const sheet = await source('./SettingsSheet.svelte');
    expect(sheet).not.toContain("oninput={(e) => editor.setSetting('paletteLimit'");
    expect(sheet).toContain("onchange={(e) => editor.setSetting('paletteLimit', Number(e.currentTarget.value))}");
    // Число рядом с ползунком идёт за пальцем всё равно.
    expect(sheet).toContain('<output>{limitShown}</output>');
  });
});

describe('GIF: чтение пикселей кадра', () => {
  it('холст, с которого каждый кадр читают getImageData, просит willReadFrequently — без него Chrome гонит кадр из видеопамяти', async () => {
    const { rasterizeFrames } = await import('../export/rasterize');
    const { createDocument } = await import('../model/operations');
    const asked: unknown[] = [];
    const ctx = new Proxy({}, {
      get: (_, key) =>
        key === 'getImageData'
          ? () => ({ data: new Uint8ClampedArray(4) })
          : key === 'canvas'
            ? { width: 64, height: 36 }
            : () => {},
      set: () => true,
    });
    const had = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({
        getContext: (_kind: string, options?: unknown) => {
          asked.push(options);
          return ctx;
        },
      }),
    };
    try {
      for await (const _ of rasterizeFrames(createDocument(), { width: 64 })) {
        break;
      }
    } finally {
      (globalThis as { document?: unknown }).document = had;
    }
    expect(asked).toEqual([{ willReadFrequently: true }]);
  });
});
