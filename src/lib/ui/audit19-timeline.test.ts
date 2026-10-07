import { describe, expect, it } from 'bun:test';
import * as track from '../audio/track';
import * as thumbs from './thumb-size';

// Девятнадцатый аудит: лента, слои, звук и транспорт.
// Компоненты на рунах проверяются по исходнику, как в audit18-timeline.test.ts;
// чистые функции — по тому, что они делают.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const transport = await Bun.file(UI + 'PlayControls.svelte').text();
const player = await Bun.file(UI + '../player/Player.svelte').text();

describe('девятнадцатый аудит: ячейка кадра не тоньше 24 px у листа любых пропорций', () => {
  // Открытый проект с листом-панорамой 1280×320 давал ячейку 48×14, с листом
  // 4000×200 — 48×4: кнопка кадра, в которую не попасть (WCAG 2.5.8, правило
  // плотной ленты в DESIGN.md — пол 24×24).
  it('панорама 4:1 — высота ячейки с рамкой 24', () => {
    expect(thumbs.cellSize(1280, 320)).toEqual({ w: 46, h: 22 });
  });

  it('узкий стоячий лист — ширина ячейки с рамкой 24', () => {
    expect(thumbs.cellSize(200, 4000)).toEqual({ w: 22, h: 46 });
  });

  it('обычные листы остаются как были', () => {
    expect(thumbs.cellSize(1280, 720)).toEqual({ w: 46, h: 26 });
    expect(thumbs.cellSize(720, 1280)).toEqual({ w: 26, h: 46 });
  });

  it('лента берёт размер ячейки отсюда', () => {
    expect(timeline).toContain('const cell = $derived(cellSize(editor.doc.width, editor.doc.height));');
  });
});

describe('девятнадцатый аудит: привязка, включённая посреди просмотра, ставит трек на кадр', () => {
  // Непривязанный трек шёл со своего начала; «Привязать к кадрам» посреди
  // просмотра оставлял его там же до конца круга — кадр N звучал не своей
  // секундой, а на длинном мульте это минуты.
  it('звучащий трек переставляется, когда привязку включили', () => {
    expect(transport).toMatch(/const retied = now && tied === false;/);
    expect(transport).toMatch(/if \(!retied && untrack\(\(\) => editor\.audio\.sounding\)\)/);
  });

  it('трек, дочитанный при скрытой вкладке, не начинает звучать под стоящими кадрами', () => {
    // Владелец после 18-го аудита: в фоне звук на паузе. Длинный трек
    // черновика дочитывался в фоне и вступал сам.
    expect(transport).toMatch(/!editor\.audio\.hasTrack \|\| !editor\.playing \|\| document\.hidden/);
  });
});

describe('девятнадцатый аудит: доигравший трек — не часы плеера', () => {
  // Firefox оставляет paused=false у доигравшего элемента: привязанный трек
  // короче мульта держал картинку на своём последнем кадре. Студия это уже
  // знает (`sounding`), плеер — нет.
  it('ended — не часы', () => {
    expect(track.trackKeepsTime({ paused: false, error: null, ended: true })).toBe(false);
  });

  it('играющий — часы', () => {
    expect(track.trackKeepsTime({ paused: false, error: null, ended: false })).toBe(true);
  });
});

describe('девятнадцатый аудит: плеер без контекста холста не падает', () => {
  it('нет контекста — кадр не рисуется, эффект не бросает', () => {
    // Safari отдаёт null, когда память холстов страницы вышла; миниатюры это
    // переживают, плеер бросал из эффекта.
    expect(player).toMatch(/as unknown as Canvas2DLike \| null;[^]{0,200}if \(!ctx\) \{\s+return;/);
  });
});

// Владелец, 2026-10-07: «обрезается кадр слоя» — у вертикального листа кадр
// 46 px, строка 52, а пол нижней панели написан под строку в 44.
describe('пол нижней панели держит строку слоя целиком при любом листе', () => {
  it('строка выше 44 px добавляет полу свою разницу', async () => {
    expect(thumbs.rowOver({ width: 720, height: 1280 })).toBe(8);
    expect(thumbs.rowOver({ width: 1280, height: 720 })).toBe(0);
    const editorUi = await Bun.file(UI + 'Editor.svelte').text();
    expect(editorUi).toMatch(/\+ wrap\s*\+ rowOver\(editor\.doc\),/);
  });
});
