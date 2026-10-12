import { describe, expect, it } from 'bun:test';
import { tourPages } from './tour';

// Тур первого входа (владелец, 2026-10-12): привет с маскотом, .toon из Тунио,
// плагины, выгрузка и звук, продолжения, открытый код — и выбор набора последней страницей.
// Клей Svelte проверяется по исходнику, как в first-visit.test.ts.
const UI = new URL('./', import.meta.url).pathname;
const tour = await Bun.file(UI + 'Tour.svelte').text();
const editor = await Bun.file(UI + 'Editor.svelte').text();
const ru = await Bun.file(UI + '../i18n/ru.json').json();

describe('тур первого входа', () => {
  it('начинается с привета и кончается выбором набора', () => {
    expect(tourPages(true)).toEqual(['welcome', 'toon', 'plugins', 'export', 'continue', 'open', 'layout']);
  });

  it('без площадки о продолжениях не рассказывает: продолжать нечего', () => {
    expect(tourPages(false)).toEqual(['welcome', 'toon', 'plugins', 'export', 'open', 'layout']);
  });

  it('у каждой страницы рассказа есть заголовок и слова', () => {
    for (const page of tourPages(true).slice(0, -1)) {
      expect(ru.tour[page].title).toBeString();
      expect(ru.tour[page].text).toBeString();
    }
  });

  it('с привета тур проходят или пропускают; «Пропустить» закрывает его совсем', () => {
    expect(tour).toContain("<button class=\"key\" onclick={() => editor.closePresetAsk()}>{t('tour.skip')}</button>");
    expect(tour).toContain("<button class=\"key primary\" onclick={() => (at = 1)}>{t('tour.start')}</button>");
  });

  it('рассказ листают вперёд и назад, последняя страница закрывается «Готово»', () => {
    expect(tour).toContain("<button class=\"key\" onclick={() => at--}>{t('tour.back')}</button>");
    expect(tour).toContain("<button class=\"key primary\" onclick={() => at++}>{t('tour.next')}</button>");
    expect(tour).toContain("<button class=\"key primary\" onclick={() => editor.closePresetAsk()}>{t('tour.done')}</button>");
  });

  it('картинки рассказа — украшение: читалка слышит заголовок и слова', () => {
    expect(tour.match(/<div class="art[^>]*aria-hidden="true"/g)?.length).toBe(5);
  });

  it('без движения картинки стоят в конце своего пути', () => {
    expect(tour).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.art \* \{\s*animation: none;/);
  });

  it('страница об открытом коде ведёт к исходникам редактора', () => {
    expect(tour).toContain("{#if page === 'open'}{' '}<a href=\"https://github.com/GeTechG/toon_platform_editor\" target=\"_blank\" rel=\"noopener\">GeTechG/toon_platform_editor</a>{/if}");
  });

  it('маскота даёт площадка, студия рисует тур на месте плашки', () => {
    expect(editor).toContain('<Tour {editor} {mascot} platform={!!onPublish} />');
    expect(editor).toContain('{#if editor.presetAsk && plateDue && !editor.arranging}');
  });
});
