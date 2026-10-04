import { describe, expect, it } from 'bun:test';
import { OFFICIAL_CATALOG, readCatalog, reviewed } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';

// Owner answers after the eighteenth audit: only what was read from our
// catalog's own address is reviewed; the thickness hint promises no growing
// step; the phone's «назад» takes the colour like a tap outside; a film in a
// hidden tab pauses its sound; fingers moving the sheet show no brush ring.

function catalogAt(address: string, entry: string) {
  return readCatalog(address, {
    fetch: async () => ({
      ok: true,
      json: async () => ({ api: PLUGIN_API, plugins: [{ id: 'halftone', name: 'h', version: '999', entry }] }),
    }),
  });
}

describe('проверено только прочитанное из каталога по нашему адресу', () => {
  it('наш каталог — проверен', async () => {
    const ours = await catalogAt(OFFICIAL_CATALOG, 'halftone/plugin.js');
    expect(reviewed(ours.plugins[0])).toBe(true);
  });

  it('чужой каталог, перечисливший наш бандл, — нет: ставится с вопросом и не обновляется сам', async () => {
    const theirs = await catalogAt('https://example.com/plugins/', `${OFFICIAL_CATALOG}halftone/plugin.js`);
    expect(theirs.plugins[0].url).toBe(`${OFFICIAL_CATALOG}halftone/plugin.js`);
    expect(reviewed(theirs.plugins[0])).toBe(false);
  });
});

describe('подсказка «Толщина» одна на все пресеты', () => {
  it('не обещает растущий шаг: под Тунио он всегда 1', async () => {
    const { t } = await import('../i18n');
    const hint = t('brush.thickness_hint');
    expect(hint).toContain('+/− меняют толщину по шагам');
    expect(hint).not.toContain('крупнее');
  });
});

describe('«назад» на телефоне принимает цвет, как тап мимо окна', () => {
  it('cancel без клавиши закрывает на выбранном; откат остался за Esc', async () => {
    const picker = await Bun.file(new URL('./ColourPicker.svelte', import.meta.url)).text();
    const cancel = picker.match(/oncancel=\{\(e\) => \{[^]*?\n  \}\}/)?.[0] ?? '';
    expect(cancel).toContain('requestClose()');
    expect(cancel).not.toContain('revert');
    expect(picker).toMatch(/if \(action === 'revert'\) requestClose\(\{ revert: true \}\)/);
  });
});

describe('вкладка в фоне: звук просмотра на паузе, по возвращении — дальше', () => {
  it('транспорт слушает видимость вкладки и трогает звук только своего просмотра', async () => {
    const controls = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
    expect(controls).toMatch(/<svelte:document onvisibilitychange=\{onVisibility\}/);
    const handler = controls.match(/function onVisibility\(\)[^]*?\n  }/)?.[0] ?? '';
    expect(handler).toMatch(/!editor\.playing \|\| !player/);
    expect(handler).toMatch(/document\.hidden[^]*editor\.audio\.stop\(\)/);
    expect(handler).toMatch(/editor\.audio\.resume\(editor\.playbackFrame, editor\.doc\.frame_rate\)/);
  });

  it('непривязанный трек продолжает с места паузы, привязанный встаёт на свой кадр', async () => {
    const audio = await Bun.file(new URL('../audio/state.svelte.ts', import.meta.url)).text();
    const resume = audio.match(/\n  resume\(frame: number, fps: number\): void \{[^]*?\n  }/)?.[0] ?? '';
    expect(resume).toMatch(/if \(this\.sync\)[^]*this\.playFrom\(frame, fps\)/);
    expect(resume).toMatch(/this\.#element\?\.play\(\)/);
  });
});

describe('пальцы двигают лист — кольца кисти под ними нет', () => {
  it('щипок и панорама пальцем гасят кольцо, а не таскают его между пальцами', async () => {
    const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
    const movesView = canvas.match(/function movesView\(e: PointerEvent\): boolean \{[^]*?\n  }/)?.[0] ?? '';
    expect(movesView).toContain("e.pointerType === 'touch'");
    expect(movesView).toMatch(/gesture !== null && touches\.has\(e\.pointerId\)/);
    expect(movesView).toMatch(/panning\?\.pointerId === e\.pointerId/);
    const move = canvas.match(/function onPointerMove\([^]*?\n  }\n/)?.[0] ?? '';
    expect(move).toMatch(/if \(movesView\(e\)\) \{\s*cursorVisible = false;/);
  });
});
