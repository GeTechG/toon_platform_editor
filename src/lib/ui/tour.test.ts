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

  // Владелец, 2026-10-13: плашка в тон стола (`--sub`) под верхним краем
  // «сливалась со всем». Она стоит посреди стола и светлее его, как окно «⋯».
  it('плашка стоит по центру стола и отличается от него тоном', () => {
    const card = tour.match(/\n  \.preset-ask \{[^}]*\}/)?.[0] ?? '';
    expect(card).toContain('inset: 0;');
    expect(card).toContain('margin: auto;');
    expect(card).toContain('height: fit-content;');
    expect(card).toContain('background: var(--paper);');
    // Сдвигом не центрируют: `translate` занят появлением (studio-pop).
    expect(card).not.toMatch(/\n\s*translate:/);
    expect(tour).not.toMatch(/\.preset-ask \{\s*top:/);
  });

  // Владелец, 2026-10-13: на телефоне под Toonio карточке остаётся 250 px —
  // три равные доли резали «Multator», а серые клавиши на бумаге гляделись выключенными.
  it('наборы на телефоне делят ряд по длине имени и не режут его', () => {
    const chip = tour.match(/:global\(\.studio\.compact\) \.preset-ask-chips button \{[^}]*\}/)?.[0] ?? '';
    expect(chip).toContain('flex: 1 1 auto;');
    expect(chip).toContain('font-size: 0.9rem;');
    expect(chip).not.toContain('min-width: 0;');
    // Не влезло и так — имена переносятся строкой, а не лезут друг под друга.
    expect(tour).not.toContain('flex-wrap: nowrap;');
  });

  it('невыбранный набор — тон вкладки, а не серая вуаль', () => {
    const chip = tour.match(/\n  \.preset-ask-chips button \{[^}]*\}/)?.[0] ?? '';
    expect(chip).toContain('background: var(--sub);');
  });

  // Владелец, 2026-10-13: в карточке шириной 250 px «Пройти тур» ломалось на
  // две строки и вылезало из клавиши.
  it('слова на клавишах тура не переносятся: тесно — клавиши мельче, совсем тесно — строкой ниже', () => {
    expect(tour).toMatch(/\n  \.tour-foot \.key \{\s*white-space: nowrap;/);
    expect(tour.match(/\n  \.tour-foot \{[^}]*\}/)?.[0]).toContain('flex-wrap: wrap;');
    const tight = tour.match(/:global\(\.studio\.compact\) \.tour-foot \.key \{[^}]*\}/)?.[0] ?? '';
    expect(tight).toContain('padding-inline: 0.75rem;');
    expect(tight).toContain('font-size: 0.95rem;');
  });

  // Владелец, 2026-10-13: открытые коробки стола на телефоне лежали под
  // карточкой тура, одно на другом. Карточка уходит, пока они открыты, и
  // возвращается на той же странице: она спрятана, а не снята.
  it('под открытыми коробками на телефоне тура не видно, страница его цела', () => {
    expect(editor).toContain("<div hidden={sideOver && !folded('right')}>\n        <Tour {editor} {mascot} platform={!!onPublish} />\n      </div>");
  });

  // Владелец, 2026-10-13: «проблема анимаций что они не влезают» — сцена была
  // 16rem при любой карточке, а под Toonio на телефоне карточке остаётся 250 px.
  it('картинка рассказа сжимается вместе с карточкой: все её размеры — в долях ширины колодца', () => {
    expect(tour).toMatch(/\n  \.art \{[^}]*container-type: inline-size;/);
    expect(tour).toMatch(/@supports \(width: 1cqw\) \{\s*\.scene \{\s*--u: min\(1rem, 100cqw \/ 16\);/);
    const pictures = tour.slice(tour.indexOf('\n  .scene {'), tour.indexOf('/* Motion off'));
    expect(pictures).toContain('width: calc(16 * var(--u));');
    // Ни одного размера мимо доли: забытый rem не сжимается и вылезает.
    expect(pictures.replace(/--u: (min\()?1rem/g, '')).not.toMatch(/\drem/);
  });

  it('маскота даёт площадка, студия рисует тур на месте плашки', () => {
    expect(editor).toContain('<Tour {editor} {mascot} platform={!!onPublish} />');
    expect(editor).toContain('{#if editor.presetAsk && plateDue && !editor.arranging}');
  });
});

// Пройден ли тур — отдельный флаг в настройках (владелец, 2026-10-12): кто был
// здесь до тура, тому он засчитан сам, а записанное посреди тура его не кончает.
describe('флаг «тур пройден»', () => {
  const { parseUiConfig } = require('./presets') as typeof import('./presets');
  const state = require('fs').readFileSync(UI + 'editor-state.svelte.ts', 'utf8') as string;

  it('настройки, записанные до тура, считают его пройденным', () => {
    expect(parseUiConfig(JSON.stringify({ preset: 'toonop' }))?.tourDone).toBe(true);
  });

  it('набор, выбранный посреди тура, его не кончает', () => {
    expect(parseUiConfig(JSON.stringify({ preset: 'toonop', tourDone: false }))?.tourDone).toBe(false);
    expect(parseUiConfig(JSON.stringify({ preset: 'toonop', tourDone: true }))?.tourDone).toBe(true);
  });

  it('студия спрашивает флаг и пишет его', () => {
    expect(state).toContain('this.presetAsk = saved === null || !saved.tourDone;');
    expect(state).toContain('tourDone: !this.presetAsk,');
  });

  it('слово площадки и подписи клавиш ждут конца тура', () => {
    expect(editor).toContain('const noteDue = $derived(plateDue && !editor.presetAsk && !(deskPhone && !tall));');
    expect(editor).toContain('class:named={named && !editor.presetAsk && !rowPressed && (noteInPanel || noteInTop || isEmptyDocument(editor.doc))}');
  });
});
