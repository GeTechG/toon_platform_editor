import { describe, expect, it } from 'bun:test';

// Seventeenth audit, the canvas and the view: the hint over the stage on a
// small screen, the thickness rail under a palm and under the film.
// CanvasView and Editor are runes components, so what they must do is
// asserted on their source.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const editorView = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`нет правила ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

// «Слой скрыт — нажми на его глаз» говорилось у нижнего края холста, а на
// телефоне там стоит окно вкладки (z-float) — как раз окно слоёв с тем глазом.
describe('подсказка холста не прячется под окном вкладки', () => {
  it('стоя окно снизу: подсказка поднимается над ним, как рейка толщины', () => {
    const low = rule(editorView, '.studio.compact .stage.low-window :global(.hint)');
    expect(low).toContain('var(--tab-window-h');
    expect(low).toContain('var(--tool-windows-h');
  });

  it('лёжа окно справа: подсказка встаёт посередине открытой части холста', () => {
    const side = rule(editorView, '.studio.compact .stage.side-window :global(.hint)');
    expect(side).toContain('min(55%, 24rem)');
    expect(side).toMatch(/max-width:/);
  });
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
