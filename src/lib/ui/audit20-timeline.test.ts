import { describe, expect, it } from 'bun:test';
import { LoopPlayer } from '../player/player';

// Двадцатый аудит: лента, слои, звук и транспорт.
// Компоненты на рунах проверяются по исходнику, как в audit19-timeline.test.ts;
// чистые функции — по тому, что они делают.
const UI = new URL('./', import.meta.url).pathname;
const transport = await Bun.file(UI + 'PlayControls.svelte').text();

describe('двадцатый аудит: после скрытой вкладки кадры идут с того, на котором встали', () => {
  // В скрытой вкладке rAF стоит, а часы плеера помнят последний тик: по
  // возвращении первый тик прыгал на всё время отсутствия. Привязанный трек
  // вставал на кадр, с которого уходили, — и до конца круга отставал от
  // картинки на эти секунды (2 с в фоне на мульте в 100 кадров).
  it('rest: следующий тик начинает отсчёт заново', () => {
    const shown: number[] = [];
    const player = new LoopPlayer({ frameCount: 100, fps: 10, startFrame: 0, onFrame: (f) => shown.push(f) });
    player.tick(0);
    player.tick(100);
    player.rest();
    player.tick(2100); // две секунды в фоне
    expect(shown).toEqual([1]);
    player.tick(2200);
    expect(shown).toEqual([1, 2]);
  });

  it('без rest пауза в тиках — прыжок (так и остаётся для подвисшего кадра)', () => {
    const shown: number[] = [];
    const player = new LoopPlayer({ frameCount: 100, fps: 10, startFrame: 0, onFrame: (f) => shown.push(f) });
    player.tick(0);
    player.tick(2000);
    expect(shown).toEqual([20]);
  });

  it('транспорт даёт часам отдохнуть, прежде чем вернуть звук', () => {
    const handler = transport.match(/function onVisibility\(\)[^]*?\n  }/)?.[0] ?? '';
    expect(handler).toMatch(/player\.rest\(\);\s+editor\.audio\.resume\(editor\.playbackFrame, editor\.doc\.frame_rate\)/);
  });
});
