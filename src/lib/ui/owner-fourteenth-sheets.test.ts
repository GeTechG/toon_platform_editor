import { describe, expect, it } from 'bun:test';
import { EXPORT_WIDTHS } from '../format/constants';
import { createDocument } from '../model/operations';
import { CANVAS_MAX_AREA, exportSize, exportWidths } from '../export/rasterize';
import { t } from '../i18n';

// Owner's answers after the fourteenth audit, the sheets.
// 1. Removing a plugin asks first — any plugin, the way wiping all the
//    palettes asks. One put in from a file says it comes back only from the
//    same file.
// 2. An export whose frame is over Safari's canvas area (4096×4096) is not
//    on offer for that document: an extreme proportion from a file or the
//    API. With nothing left, the largest width that fits is offered instead.
const UI = new URL('./', import.meta.url).pathname;
const pluginsSheet = await Bun.file(UI + 'PluginsSheet.svelte').text();
const exportSheet = await Bun.file(UI + 'ExportSheet.svelte').text();

const doc = (width: number, height: number) => createDocument({ width, height });
const area = (size: { width: number; height: number }) => size.width * size.height;

describe('удаление плагина спрашивает', () => {
  const remove = pluginsSheet.match(/async function remove\(plugin: InstalledPlugin\)[^]*?\n  }\n/)![0];

  it('перед удалением — тот же вопрос confirm, что у «Удалить все» палитры', () => {
    expect(remove).toMatch(/if \(!\(await editor\.ask\(/);
    expect(remove.indexOf('editor.ask(')).toBeLessThan(remove.indexOf('editor.removePlugin'));
  });

  it('поставленный файлом получает свой вопрос: вернуть можно только тем же файлом', () => {
    expect(remove).toMatch(/plugin\.source === 'local'/);
    expect(remove).toMatch(/plugins\.remove_local_confirm/);
    expect(remove).toMatch(/plugins\.remove_confirm/);
  });

  it('вопросы по-русски, с именем плагина', () => {
    const any = t('plugins.remove_confirm', { name: 'Линейка' });
    const local = t('plugins.remove_local_confirm', { name: 'Линейка' });
    expect(any).toMatch(/Удалить/);
    expect(any).toContain('Линейка');
    expect(local).toContain('Линейка');
    expect(local).toMatch(/тем же файлом/);
    expect(any + local).not.toMatch(/(^|[^а-яё])оп([^а-яё]|$)/i);
  });
});

describe('экспорт не предлагает кадр больше предела холста Safari', () => {
  it('предел — площадь 4096×4096', () => {
    expect(CANVAS_MAX_AREA).toBe(4096 * 4096);
  });

  it('обычный 16:9 получает все ширины, размеры прежние', () => {
    expect(exportWidths(doc(10240, 5760))).toEqual([...EXPORT_WIDTHS]);
    expect(exportSize(doc(10240, 5760), 2560)).toEqual({ width: 2560, height: 1440 });
  });

  it('600×2000: 2560 не предлагается, остальные — да', () => {
    const tall = doc(600, 2000);
    expect(exportWidths(tall)).toEqual([640, 1280, 1920]);
    for (const w of exportWidths(tall)) {
      expect(area(exportSize(tall, w))).toBeLessThanOrEqual(CANVAS_MAX_AREA);
    }
  });

  it('1×32767: не влезает ни одна — предлагается самая большая, что влезает', () => {
    const needle = doc(1, 32767);
    const [only, ...rest] = exportWidths(needle);
    expect(rest).toEqual([]);
    expect(only).toBeGreaterThanOrEqual(1);
    expect(area(exportSize(needle, only))).toBeLessThanOrEqual(CANVAS_MAX_AREA);
    expect(exportSize(needle, only).width).toBe(only);
  });

  it('ширина сверх предела ужимается в самом exportSize — для GIF, видео и PNG разом', () => {
    const tall = doc(600, 2000);
    expect(area(exportSize(tall, 2560))).toBeLessThanOrEqual(CANVAS_MAX_AREA);
    expect(area(exportSize(doc(1, 32767), 640))).toBeLessThanOrEqual(CANVAS_MAX_AREA);
  });

  it('лист экспорта перебирает только предложенные ширины и ужимает выбранную', () => {
    expect(exportSheet).toMatch(/exportWidths\(editor\.doc\)/);
    expect(exportSheet).toMatch(/\{#each offeredWidths as w \(w\)\}/);
    expect(exportSheet).not.toMatch(/\{#each EXPORT_WIDTHS as w/);
  });

  it('пропавшие ширины объяснены и читалке: строка привязана к группе', () => {
    expect(exportSheet).toMatch(/aria-describedby=\{widthsCut \? 'export-widths-cut' : undefined\}/);
    expect(exportSheet).toMatch(/id="export-widths-cut"/);
    expect(t('export.widths_cut')).toMatch(/Safari|браузер/);
    expect(t('export.widths_cut')).toMatch(/[Мм]ульт/);
    expect(t('export.widths_cut')).not.toMatch(/(^|[^а-яё])оп([^а-яё]|$)/i);
  });
});
