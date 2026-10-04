import { describe, expect, it } from 'bun:test';
import * as track from '../audio/track';
import { extendTarget, rangeSelection } from './frame-selection';

// Восемнадцатый аудит: лента, слои, звук и транспорт.
// Компоненты на рунах проверяются по исходнику, как в audit17-timeline.test.ts;
// чистые функции — по тому, что они делают.
const UI = new URL('./', import.meta.url).pathname;
const player = await Bun.file(UI + '../player/Player.svelte').text();
const shell = await Bun.file(UI + 'Editor.svelte').text();
const state = await Bun.file(UI + '../audio/state.svelte.ts').text();

describe('восемнадцатый аудит: название и автор трека из черновика — те, что набрал человек', () => {
  it('теги файла читаются только у свежего файла, а не при каждом открытии черновика', () => {
    // mp3 с ID3 «Song / Band»: человек назвал трек по-своему и стёр автора, а
    // каждое открытие черновика возвращало теги — и они же уходили в публикацию.
    expect(state).toContain('tags = keep ? tags : readId3(bytes)');
  });
});

describe('восемнадцатый аудит: плеер не стоит на кадре из-за трека, который не загрузился', () => {
  // Chrome: после неудачной загрузки (404, обрыв, ogg в Safari 16) элемент
  // остаётся paused=false с error и currentTime=0. Привязанный плеер читал
  // кадр с его часов — и картинка стояла на первом кадре при кнопке «Пауза».
  it('трек с ошибкой — не часы', () => {
    expect(track.trackKeepsTime({ paused: false, error: { code: 4 } })).toBe(false);
  });

  it('играющий трек — часы, остановленный — нет', () => {
    expect(track.trackKeepsTime({ paused: false, error: null })).toBe(true);
    expect(track.trackKeepsTime({ paused: true, error: null })).toBe(false);
  });

  it('плеер спрашивает её, прежде чем брать кадр со звука', () => {
    expect(player).toContain('if (trackKeepsTime(sound)) {');
    expect(player).not.toContain('if (!sound.paused) {');
  });
});

describe('восемнадцатый аудит: Shift+стрелка из середины блока', () => {
  // Стрелки ходят внутри блока, не снимая его; активная ячейка — якорь. Из
  // середины «дальним краем» считался левый: Shift+→ схлопывал блок 3–7 в одну
  // ячейку вместо того, чтобы тянуть его вправо.
  const bounds = { frames: 10, layers: 4 };
  const block = { frames: [2, 3, 4, 5, 6], layers: [0] };
  const active = { frame: 3, layer: 0 };

  it('Shift+→ тянет правый край', () => {
    expect(rangeSelection(active, extendTarget(block, active, 1, 0, bounds), bounds).frames).toEqual([3, 4, 5, 6, 7]);
  });

  it('Shift+← тянет левый край', () => {
    expect(rangeSelection(active, extendTarget(block, active, -1, 0, bounds), bounds).frames).toEqual([1, 2, 3]);
  });

  it('по слоям так же: Shift+↑ из середины растёт вверх', () => {
    const rows = { frames: [0], layers: [0, 1, 2] };
    expect(rangeSelection({ frame: 0, layer: 1 }, extendTarget(rows, { frame: 0, layer: 1 }, 0, 1, bounds), bounds).layers).toEqual([1, 2, 3]);
  });
});

describe('восемнадцатый аудит: подписи трека не пишутся в чужой черновик', () => {
  it('пока трек читается, в полях ещё прежний — запись подписей ждёт', () => {
    // Открыли черновик Б при треке черновика А: привязка уже Б, а название и
    // автор до конца чтения — от А. Запись уходила в Б и двигала его дату.
    expect(shell).toMatch(/credits === storedCredits \|\| editor\.audio\.loading \|\|/);
  });
});
