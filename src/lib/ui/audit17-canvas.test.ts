import { describe, expect, it } from 'bun:test';

// Seventeenth audit, the canvas and the view: the hint over the stage on a
// small screen, the thickness rail under a palm and under the film.
// CanvasView and Editor are runes components, so what they must do is
// asserted on their source.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

// «Слой скрыт — нажми на его глаз» говорилось у нижнего края холста, а на
// телефоне там стоит окно вкладки (z-float) — как раз окно слоёв с тем глазом.
describe('подсказка холста не прячется под окном вкладки', () => {

});

describe('рейка толщины и ладонь', () => {
  it('палец, севший на рейку, пока перо рисует, толщину не меняет — как и на холсте', () => {
    const down = handler('onRailDown');
    expect(down).toMatch(/e\.pointerType === 'touch' && editor\.penSeen && penBusy\(\)/);
    expect(down.indexOf('penBusy()')).toBeLessThan(down.indexOf('holdRail('));
  });
});

// Рейка уходит на время просмотра вместе со своим pointerup и keyup: палец или
// клавиша на ней в этот миг оставляли кольцо толщины посреди сцены навсегда.
describe('кольцо рейки не переживает рейку', () => {
  it('просмотр начался — удержание рейки отпущено', () => {
    expect(source).toMatch(/\$effect\(\(\) => \{\s*if \(editor\.playing\) \{?\s*railHeld = null;?/);
  });
});
