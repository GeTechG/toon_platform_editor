import { describe, expect, it } from 'bun:test';
import { playRefusal, readId3 } from '../audio/track';
import { fpsFromField, onScrollbar, stepColumn } from './frame-selection';
import { rowHeight, rowHeightCss } from './thumb-size';

// Fourteenth audit, the timeline, the layers and the sound. Svelte components
// are asserted as source, as in audit13-timeline.test.ts: the runes need the
// compiler to run.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const timelineStyle = timeline.slice(timeline.indexOf('<style'));
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const rowsStyle = rows.slice(rows.indexOf('<style'));
const play = await Bun.file(UI + 'PlayControls.svelte').text();
const editorSource = await Bun.file(UI + 'Editor.svelte').text();
const audioState = await Bun.file(UI + '../audio/state.svelte.ts').text();

/** A function's body out of a component's source, up to its closing brace. */
function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('четырнадцатый аудит: строка слоя растёт с текстом', () => {
  // При 150 % текста глаз был 42 px в строке 32 px и заходил на соседние
  // строки на 10 px: нажатие у края попадало в чужой слой (WCAG 1.4.4, 2.5.8).
  it('высота строки не ниже клавиш строки, в rem', () => {
    const doc = { width: 1280, height: 720 };
    expect(rowHeightCss(doc)).toBe(`max(${rowHeight(doc)}px, calc(1.75rem + 4px))`);
  });

  it('строка слоя и ряд ячеек берут одну и ту же высоту', () => {
    expect(rows).toMatch(/style:height=\{rowHeightCss\(editor\.doc\)\}/);
    expect(timeline).toMatch(/class="cells" style:height=\{rowHeightCss\(editor\.doc\)\}/);
  });

  it('перетаскивание слоя считает строки по их настоящей высоте', () => {
    // Строка выше числа из документа: шаг по числу двигал слой на две строки за одну.
    expect(fn(rows, 'updateTarget')).toContain('drag.rowPx');
    expect(fn(rows, 'onHandleDown')).toMatch(/rowPx: .*getBoundingClientRect\(\)\.height/);
  });

  it('активный ряд показывается по настоящей высоте ряда', () => {
    expect(timeline).toMatch(/querySelector<HTMLElement>\('\.cells'\)\?\.getBoundingClientRect\(\)\.height/);
  });
});

describe('четырнадцатый аудит: имена слоёв стоят вровень со своими ячейками', () => {
  it('шапка кадров той же высоты, что шапка «+ Слой» (2rem)', () => {
    // Шапка кадров была 32 px, а «+ Слой» 2rem: при 150 % текста все имена
    // съезжали на 16 px вниз от своих ячеек, при 200 % — на 32.
    expect(timelineStyle).toMatch(/\.head \{[^}]*height: 2rem;/);
    expect(timelineStyle).toMatch(/\.num \{[^}]*line-height: 2rem;/);
    expect(rowsStyle).toMatch(/\.head \{[^}]*box-sizing: border-box;[^}]*height: 2rem;/);
  });
});

describe('четырнадцатый аудит: отказ play() называется по причине', () => {
  it('запрет браузера — «не дал включить звук»', () => {
    expect(playRefusal({ name: 'NotAllowedError' })).toBe('blocked');
  });

  it('play(), прерванный остановкой или сменой трека, — не ошибка', () => {
    // Space дважды подряд: pause() обрывает play(), и Chrome отвечает AbortError.
    // Это читалось как «браузер не дал включить звук».
    expect(playRefusal({ name: 'AbortError' })).toBeNull();
  });

  it('формат, который элемент не играет, — «браузер не проигрывает»', () => {
    expect(playRefusal({ name: 'NotSupportedError' })).toBe('unplayable');
    expect(playRefusal(new Error('что-то'))).toBe('unplayable');
  });

  it('трек разбирает отказ через неё', () => {
    expect(audioState).toContain('playRefusal(err)');
  });
});

describe('четырнадцатый аудит: переключатель привязки будит умолкший трек', () => {
  it('эффект, что подключает звук к идущему просмотру, слушает привязку', () => {
    // Привязанный короткий трек доиграл и встал; отвязанный посреди просмотра
    // он молчал до следующего нажатия «Проиграть».
    const effect = play.match(/\$effect\(\(\) => \{(?:(?!\$effect)[\s\S])*?editor\.audio\.playFrom\(untrack[\s\S]*?\n  \}\);/)?.[0] ?? '';
    expect(effect).toContain('void editor.audio.sync');
  });
});

describe('четырнадцатый аудит: пустое поле fps', () => {
  const range = [5, 24] as const;
  it('стёртое поле возвращает прежнюю частоту, а не минимум', () => {
    expect(fpsFromField('', 12, range)).toBe(12);
    expect(fpsFromField('   ', 12, range)).toBe(12);
    // Firefox пускает в числовое поле буквы; value тогда пустое.
    expect(fpsFromField('abc', 12, range)).toBe(12);
  });

  it('число зажимается в диапазон', () => {
    expect(fpsFromField('8', 12, range)).toBe(8);
    expect(fpsFromField('0', 12, range)).toBe(5);
    expect(fpsFromField('99', 12, range)).toBe(24);
  });

  it('студия читает поле через неё', () => {
    expect(fn(editorSource, 'onFpsChange')).toContain('fpsFromField(');
  });
});

describe('четырнадцатый аудит: полоса прокрутки ленты — не пустое место', () => {
  // Нажатие на полосу прокрутки (Chrome и Firefox шлют pointerdown ленте)
  // сбрасывало выделенный блок — ровно когда его тянут к дальним кадрам.
  const box = { left: 100, top: 50, clientLeft: 0, clientTop: 0, clientWidth: 400, clientHeight: 200 };
  it('нажатие ниже или правее клиентской области — на полосе', () => {
    expect(onScrollbar(box, 300, 255)).toBe(true);
    expect(onScrollbar(box, 505, 100)).toBe(true);
  });

  it('нажатие внутри — нет', () => {
    expect(onScrollbar(box, 300, 100)).toBe(false);
  });

  it('лента не сбрасывает выделение с полосы', () => {
    expect(fn(timeline, 'resetSelection')).toContain('onScrollbar(');
  });
});

describe('четырнадцатый аудит: разделитель колонки слоёв с клавиатуры', () => {
  it('шаг идёт от показанной ширины, а не от запомненной', () => {
    // Запомнено 320, а max-width: 50 % показывает 200: стрелка влево молчала
    // семь нажатий подряд.
    expect(stepColumn(200, -16, 128, 320)).toBe(184);
  });

  it('стрелка влево никогда не расширяет колонку', () => {
    // На телефоне колонка уже нижнего предела в 128: ← делало её шире.
    expect(stepColumn(111, -16, 128, 320)).toBe(111);
    expect(stepColumn(140, -16, 128, 320)).toBe(128);
  });

  it('стрелка вправо никогда не сужает', () => {
    expect(stepColumn(330, 16, 128, 320)).toBe(330);
    expect(stepColumn(310, 16, 128, 320)).toBe(320);
  });

  it('клавиши шагают от показанной ширины', () => {
    expect(fn(timeline, 'onColKey')).toContain('stepColumn(colPx');
  });

  it('значение разделителя не выходит за свои min и max', () => {
    expect(timeline).toMatch(/aria-valuemin=\{Math\.min\(COL_MIN, colPx\)\}/);
    expect(timeline).toMatch(/aria-valuemax=\{Math\.max\(COL_MAX, colPx\)\}/);
  });

  it('тянет только основная кнопка', () => {
    expect(fn(timeline, 'onColDown')).toContain('e.button !== 0');
  });
});

describe('четырнадцатый аудит: отказ перенести слой не выдаётся за перенос', () => {
  // Трансформация под замком (paranoid mode) отказывает и выбору, и переносу:
  // перетаскивание всё равно шло, строка «ехала», а читалка говорила «позиция 2 из 3».
  it('захват ручки, которому отказали в выборе слоя, не начинает перетаскивание', () => {
    expect(fn(rows, 'onHandleDown')).toMatch(/editor\.selectLayer\(layerIndex\);[\s\S]*if \(editor\.activeLayer !== layerIndex\) \{\n      return;/);
  });

  it('шаг перетаскивания считается сделанным, только если слой переехал', () => {
    expect(fn(rows, 'updateTarget')).toMatch(/editor\.moveLayerTo\(drag\.currentLayer, targetLayer[^;]*\);\n\s*if \(editor\.doc\.layers\[targetLayer\] !== moved\)/);
  });

  it('Alt+↑/↓ объявляет позицию, только если слой переехал', () => {
    expect(fn(rows, 'moveBy')).toMatch(/if \(editor\.doc\.layers\[to\] !== layer\) \{\n      return;/);
  });
});

describe('четырнадцатый аудит: имя, набранное до смены рисунка, не уходит чужому слою', () => {
  // Брошенный файл заменял документ посреди переименования: поле вставало в
  // строке нового рисунка с тем же номером и по уходу фокуса называло его слой.
  it('переименование привязано к самому слою, не к его номеру', () => {
    expect(rows).toMatch(/renaming = \{ layer: layerIndex, ref: editor\.doc\.layers\[layerIndex\], text:/);
    expect(fn(rows, 'commitRename')).toContain('editor.doc.layers[renaming.layer] === renaming.ref');
    expect(rows).toContain('{#if renaming?.ref === editor.doc.layers[layerIndex]}');
  });
});

describe('четырнадцатый аудит: удержание пальца не переживает ленту', () => {
  it('таймер долгого нажатия снимается, когда лента уходит', () => {
    expect(timeline).toMatch(/\$effect\(\(\) => cancelLongPress\);/);
  });
});

describe('четырнадцатый аудит: прокрутка и штрих не пересчитывают лишнего', () => {
  it('волна считается при смене трека, частоты или ширины кадра, а не на каждый штрих', () => {
    expect(timeline).toMatch(/const fps = \$derived\(editor\.doc\.frame_rate\);/);
    expect(timeline).toMatch(/const waveBars = \$derived\(/);
    expect(timeline).not.toContain('{@const bars = editor.audio.bars(');
  });

  it('окно кадров пересобирается, когда меняются его границы, а не на каждый пиксель прокрутки', () => {
    expect(timeline).toMatch(/const firstBuilt = \$derived\(view\.first\);/);
    expect(timeline).toMatch(/const built = \$derived\(Array\.from\(\{ length: countBuilt \}/);
  });
});

describe('четырнадцатый аудит: iPhone не увеличивает страницу на поле', () => {
  // Safari на iPhone приближает страницу к полю мельче 16 px и не отдаляет
  // обратно: после переименования слоя студия оставалась увеличенной.
  const audio = Bun.file(UI + 'AudioPanel.svelte').text();
  const coarse = (style: string, selector: string) =>
    new RegExp(`@media \\(pointer: coarse\\) \\{[^@]*${selector} \\{[^}]*font-size: max\\(16px, `).test(style);

  it('поле имени слоя', () => {
    expect(coarse(rowsStyle, '\\.rename')).toBe(true);
  });

  it('поля названия и автора звука', async () => {
    const text = await audio;
    expect(coarse(text.slice(text.indexOf('<style')), '\\.field input')).toBe(true);
  });

  it('числовое поле fps', () => {
    expect(coarse(editorSource.slice(editorSource.indexOf('<style')), "\\.fps-inline input\\[type='number'\\]")).toBe(true);
  });
});

describe('четырнадцатый аудит: миниатюра без холста не роняет ленту', () => {
  // Safari отдаёт null вместо 2D-контекста, когда память холстов кончилась
  // (длинный мульт на iPhone): setTransform на null бросал в эффекте.
  it.each(['LayerThumb.svelte', 'FrameThumb.svelte'])('%s рисует, только получив контекст', async (name) => {
    const text = await Bun.file(UI + name).text();
    expect(text).toMatch(/getContext\('2d'\)[\s\S]*?\| null;(?:\n\s*\/\/[^\n]*)*\n\s*if \(!ctx\) \{\n\s*return;/);
  });
});

describe('четырнадцатый аудит: читалка слышит скопированную ячейку', () => {
  // Скопированный блок был только пунктиром и значком ⧉ в шапке: читалке
  // нечем было узнать, что вставит V (WCAG 1.3.1).
  it('имя ячейки называет её скопированной', async () => {
    const ru = await Bun.file(UI + '../i18n/ru.json').json();
    expect(ru.timeline.cell_copied).toBe(', скопирован');
    expect(timeline).toMatch(/aria-label=\{`\$\{t\([\s\S]*?\)\}\$\{editor\.isCopiedCell\(i, layerIndex\) \? t\('timeline\.cell_copied'\) : ''\}`\}/);
  });
});

describe('четырнадцатый аудит: ID3 с «рассинхронизацией»', () => {
  // Старые кодировщики (iTunes, Windows Media) пишут тег с флагом
  // unsynchronisation: за каждым 0xFF идёт 0x00. BOM FF FE читался как FF 00,
  // и название UTF-16 приходило мусором.
  const utf16 = (text: string) => [0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])];
  const unsync = (bytes: number[]) => bytes.flatMap((b) => (b === 0xff ? [0xff, 0] : [b]));

  it('v2.3: флаг тега снимается со всего тега', () => {
    const data = [1, ...utf16('Ёж')];
    const frame = [...'TIT2'].map((c) => c.charCodeAt(0));
    const body = unsync([...frame, 0, 0, 0, data.length, 0, 0, ...data]);
    const buffer = Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0x80, 0, 0, 0, body.length, ...body]).buffer;
    expect(readId3(buffer).title).toBe('Ёж');
  });

  it('v2.4: флаг кадра и указатель длины данных', () => {
    const data = [1, ...utf16('Ёж')];
    const stored = [0, 0, 0, data.length, ...unsync(data)];
    const frame = [...'TPE1'].map((c) => c.charCodeAt(0));
    const body = [...frame, 0, 0, 0, stored.length, 0, 0x03, ...stored];
    const buffer = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length, ...body]).buffer;
    expect(readId3(buffer).artist).toBe('Ёж');
  });
});
