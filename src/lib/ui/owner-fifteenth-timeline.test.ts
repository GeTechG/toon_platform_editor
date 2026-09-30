import { describe, expect, it } from 'bun:test';
import { playableAccept, playableHere, unlockElement } from '../audio/track';

// Ответы владельца после пятнадцатого аудита: таймлайн и звук. Компоненты на
// рунах проверяются по исходнику, как в audit15-timeline.test.ts.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const timelineStyle = timeline.slice(timeline.indexOf('<style'));
const panel = await Bun.file(UI + 'AudioPanel.svelte').text();
const player = await Bun.file(UI + '../player/Player.svelte').text();
const state = await Bun.file(UI + '../audio/state.svelte.ts').text();
const ru = JSON.parse(await Bun.file(UI + '../i18n/ru.json').text());

/** Правило стиля целиком, от селектора до закрывающей скобки. */
function rule(selector: string): string {
  return timelineStyle.match(new RegExp(`\\n  ${selector.replace(/[.:]/g, '\\$&')} \\{[^}]*\\}`))?.[0] ?? '';
}

describe('владелец: разделитель колонки слоёв не отбирает нажатие у кадра и корзины', () => {
  it('зона захвата 24 px — своё место между колонками, а не нахлёст на соседей', () => {
    // Невидимая полоса 24 px над зазором 7 px заходила на ячейку кадра 1 и на
    // корзину слоя: нажатие у края ячейки начинало менять ширину колонки.
    const band = rule('.col-resizer');
    expect(band).toMatch(/width: 24px;/);
    expect(band).not.toMatch(/margin: [^;]*-/);
    expect(rule('.col-resizer::after')).not.toMatch(/width: 24px;/);
  });
});

describe('владелец: «играть» за концом привязанного трека разблокирует звук на iOS', () => {
  it('play() и сразу pause() — в том же нажатии, без звука', () => {
    const calls: string[] = [];
    const el = {
      play: () => {
        calls.push('play');
        return Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
      },
      pause: () => calls.push('pause'),
    };
    unlockElement(el);
    expect(calls).toEqual(['play', 'pause']);
  });

  it('студия и плеер зовут его, когда кадр за концом трека', () => {
    const playFrom = state.match(/playFrom\([\s\S]*?\n  }/)?.[0] ?? '';
    expect(playFrom).toMatch(/at === null\) \{[\s\S]*unlockElement\(this\.#element\)/);
    expect(player).toMatch(/\} else \{[\s\S]{0,400}unlockElement\(sound\)/);
  });
});

describe('владелец: в студию попадает только звук, который браузер играет', () => {
  const safari = (type: string) => (/ogg|opus/.test(type) ? '' : 'maybe');

  it('формат по типу файла или, если тип чужой, по расширению', () => {
    expect(playableHere({ type: 'audio/mpeg', name: 'a.mp3' }, safari)).toBe(true);
    expect(playableHere({ type: 'audio/ogg', name: 'a.ogg' }, safari)).toBe(false);
    expect(playableHere({ type: 'video/ogg', name: 'a.ogg' }, safari)).toBe(false);
    expect(playableHere({ type: '', name: 'a.opus' }, safari)).toBe(false);
    expect(playableHere({ type: '', name: 'a.wav' }, safari)).toBe(true);
    expect(playableHere({ type: 'audio/x-m4a', name: 'a.m4a' }, (t) => (t === 'audio/mp4' ? 'probably' : ''))).toBe(true);
  });

  it('выбор файла предлагает только играемые расширения', () => {
    const accept = playableAccept(safari);
    expect(accept).toContain('.mp3');
    expect(accept).toContain('.wav');
    expect(accept).not.toContain('.ogg');
    expect(accept).not.toContain('.opus');
    expect(panel).toMatch(/accept=\{accept\}/);
  });

  it('свежий выбор отказывает понятной строкой; черновик держится как был', () => {
    expect(state).toMatch(/!keep && !playableHere\(/);
    expect(state).toContain("t('audio.unsupported')");
    expect(ru.audio.unsupported).toBeString();
  });
});
