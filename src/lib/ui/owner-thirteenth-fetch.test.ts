import { afterEach, describe, expect, it } from 'bun:test';
import { BUNDLE_TIMEOUT_MS, CATALOG_TIMEOUT_MS, readCatalog } from '../plugins/catalog';
import { download, forPerson } from '../plugins/install';
import { exportVideo } from '../export/video';
import { createDocument } from '../model/operations';
import { t } from '../i18n';

// Owner, after the thirteenth audit: a catalog or a bundle that never answers
// left the sheet on «Читаю каталог…» / «Качается…» for good, with no «Повторить».
// A read has a deadline now; running out of it is said in our words, and
// leaving the sheet calls the read off instead of leaving it hanging.
const UI = new URL('./', import.meta.url).pathname;
const pluginsSheet = await Bun.file(UI + 'PluginsSheet.svelte').text();
const settingsSheet = await Bun.file(UI + 'SettingsSheet.svelte').text();
const exportSheet = await Bun.file(UI + 'ExportSheet.svelte').text();

/** A network that takes the request and never answers; it keeps the signal it got. */
function silent() {
  const seen: (AbortSignal | undefined)[] = [];
  return {
    seen,
    fetch: (_url: string, init?: { signal?: AbortSignal }) => {
      seen.push(init?.signal);
      return new Promise<never>(() => {});
    },
  };
}

describe('the catalog has a deadline', () => {
  it('is fifteen seconds by default: an index of a few kilobytes, even on a slow phone', () => {
    expect(CATALOG_TIMEOUT_MS).toBe(15_000);
    expect(BUNDLE_TIMEOUT_MS).toBe(30_000);
  });

  it('a catalog that never answers comes back with its own reason, and the request is called off', async () => {
    const net = silent();
    const catalog = await readCatalog('https://plugins.example/', { fetch: net.fetch, timeout: 20 });
    expect(catalog.plugins).toEqual([]);
    expect(catalog.error).toBe(t('plugin.catalog_timeout', { count: 1 }));
    expect(net.seen[0]?.aborted).toBe(true);
  });

  it('says so in our words, on «ты», with the seconds', () => {
    expect(t('plugin.catalog_timeout', { count: 15 })).toBe('каталог не ответил за 15 секунд — проверь сеть и попробуй ещё раз');
  });

  it('a body that stalls after the headers runs out of time as well', async () => {
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: async () => ({ ok: true, json: () => new Promise<never>(() => {}) }),
      timeout: 20,
    });
    expect(catalog.error).toBe(t('plugin.catalog_timeout', { count: 1 }));
  });

  it('any other failure still carries the browser’s reason', async () => {
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
      timeout: 1000,
    });
    expect(catalog.error).toBe(t('plugin.catalog_unreadable', { reason: 'Failed to fetch' }));
  });

  it('a read called off by its caller stops at once, aborts the request, and reports nothing', async () => {
    const net = silent();
    const stop = new AbortController();
    const reading = readCatalog('https://plugins.example/', { fetch: net.fetch, timeout: 60_000 }, stop.signal);
    stop.abort();
    const catalog = await reading;
    expect(catalog.aborted).toBe(true);
    expect(catalog.error).toBeUndefined();
    expect(net.seen[0]?.aborted).toBe(true);
  });
});

describe('the bundle has a deadline', () => {
  it('a bundle that never arrives says it ran out of time, and the person sees that line', async () => {
    const net = silent();
    const got = await download('https://plugins.example/p.js', { fetch: net.fetch, timeout: 20 });
    expect(got).toBe(t('plugins.download_timeout', { count: 1 }));
    expect(net.seen[0]?.aborted).toBe(true);
    const shown = t('plugins.download_timeout', { count: BUNDLE_TIMEOUT_MS / 1000 });
    expect(shown).toBe('не скачался за 30 секунд — проверь сеть и попробуй ещё раз');
    expect(forPerson(shown)).toBe(shown);
  });

  it('a download called off by its caller aborts the request', async () => {
    const net = silent();
    const stop = new AbortController();
    const pending = download('https://plugins.example/p.js', { fetch: net.fetch, timeout: 60_000 }, stop.signal);
    stop.abort();
    expect(typeof (await pending)).toBe('string');
    expect(net.seen[0]?.aborted).toBe(true);
  });
});

describe('the plugins sheet calls its reads off when it goes', () => {
  it('the catalog read gets a signal that the effect aborts on cleanup', () => {
    expect(pluginsSheet).toMatch(/readCatalog\(address, undefined, [a-z]+\.signal\)/);
    expect(pluginsSheet).toMatch(/return \(\) => \{[^}]*\.abort\(\)/);
  });

  it('a download is aborted with the sheet, and a called-off one writes no report', () => {
    expect(pluginsSheet).toMatch(/download\(entry\.url, undefined, [a-z]+\.signal\)/);
    const ask = pluginsSheet.slice(pluginsSheet.indexOf('async function askInstall'));
    expect(ask.slice(0, ask.indexOf('report ='))).toMatch(/signal\.aborted\) \{\s*return;/);
  });
});

describe('a file that will not read', () => {
  it('a plugin file says so instead of throwing', () => {
    const body = pluginsSheet.slice(pluginsSheet.indexOf('async function onBundleFile'));
    expect(body.slice(0, body.indexOf('pending ='))).toMatch(/try \{[^]*file\.text\(\)[^]*catch[^]*plugins\.file_unreadable/);
    expect(t('plugins.file_unreadable')).not.toBe('plugins.file_unreadable');
    expect(forPerson(t('plugins.file_unreadable'))).toBe(t('plugins.file_unreadable'));
  });

  it('a palettes file says so instead of throwing', () => {
    const body = settingsSheet.slice(settingsSheet.indexOf('async function onPaletteFile'));
    expect(body.slice(0, body.indexOf('async function onDraftFile'))).toMatch(/try \{[^]*file\.text\(\)[^]*catch[^]*settings\.palettes_unreadable/);
    expect(t('settings.palettes_unreadable')).not.toBe('settings.palettes_unreadable');
  });
});

describe('the export sheet holds its choices while it builds', () => {
  it('format and resolution keys go disabled while busy', () => {
    const formats = exportSheet.slice(exportSheet.indexOf('aria-label={t(\'export.format\')}'), exportSheet.indexOf('{#if format === \'project\' && editor'));
    const keys = formats.match(/<button[^>]*>/g) ?? [];
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const key of keys) {
      expect(key).toMatch(/disabled=\{[^}]*busy !== ''/);
    }
    const toggles = formats.match(/<input[^>]*>/g) ?? [];
    for (const toggle of toggles) {
      expect(toggle).toMatch(/disabled=\{busy !== ''\}/);
    }
  });
});

describe('a recorder that fails mid-way stops the recording', () => {
  const saved: Record<string, unknown> = {};
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      (globalThis as Record<string, unknown>)[key] = value;
    }
  });

  it('rejects with the recorder’s reason instead of playing the rest out', async () => {
    for (const key of ['document', 'MediaRecorder']) {
      saved[key] = (globalThis as Record<string, unknown>)[key];
    }
    const noop = () => {};
    const ctx: unknown = new Proxy({}, { get: (_target, prop) => (prop === 'canvas' ? {} : noop) });
    const track = { stop: noop, requestFrame: noop };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      captureStream: () => ({ getVideoTracks: () => [track], getTracks: () => [track], addTrack: noop }),
    };
    (globalThis as Record<string, unknown>).document = { createElement: () => canvas };
    class FailingRecorder {
      state = 'inactive';
      ondataavailable: ((e: unknown) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = 'recording';
        setTimeout(() => this.onerror?.(), 30);
      }
      stop() {
        this.state = 'inactive';
      }
    }
    (globalThis as Record<string, unknown>).MediaRecorder = FailingRecorder;

    const doc = createDocument({ frameRate: 24 });
    const started = performance.now();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const run = exportVideo(doc, {
        plan: { extension: 'webm', label: 'WebM', realtime: true, format: { extension: 'webm', mimeType: 'video/webm' } as never },
        trackSeconds: 10,
      });
      await expect(run).rejects.toThrow(t('export.recording_failed'));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(performance.now() - started).toBeLessThan(1000);
    expect(unhandled).toEqual([]);
  }, 15_000);
});
