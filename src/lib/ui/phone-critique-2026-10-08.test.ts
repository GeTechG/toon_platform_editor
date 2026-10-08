import { describe, expect, it } from 'bun:test';

// What the phone critique of 2026-10-08 found by a live run on 390×844,
// 360×740 and 844×390, and what was set right after it.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();
const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const icons = await Bun.file(new URL('./Icon.svelte', import.meta.url)).text();
const ru = JSON.parse(await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text());
const path = (name: string): string => icons.match(new RegExp(`'${name}':\\s*'([^']+)'`))?.[1] ?? '';

describe('«⋯» gives way to the sheet it opened', () => {
  // The window stayed open under «Экспорт» and «Настройки». Shut before the
  // key's own press is heard, with the focus on «⋯»: the sheet gives it back there.
  it('a key in the window that opens a sheet shuts the window first', () => {
    expect(editorUi).toMatch(/id="more-window"[\s\S]*?onclickcapture=\{shutMoreForSheet\}/);
    const fn = editorUi.match(/function shutMoreForSheet\([^]*?\n  \}/)?.[0] ?? '';
    expect(fn).toContain(`closest('[aria-haspopup="dialog"]')`);
    expect(fn).toContain('closeMore()');
  });
});

describe('the names a first visit hangs under the row of keys', () => {
  // «Карандаш» was 53 px at the label's size where the tools stand 48 px
  // apart, and wore «Каранд.» for it. The tool is a brush now (owner,
  // 2026-10-08) — «Кисть» fits, and no tool needs a cut name.
  // Lying down the transport stands in the same row: «Предыдущий кадр» lay
  // across «Добавить кадр» and «Следующий кадр». They wear short names there.
  it('the transport wears short names in the row', () => {
    expect([ru.editor.add_frame_short, ru.editor.prev_short, ru.editor.next_short, ru.play.play_short, ru.play.stop_short]).toEqual(['Кадр', 'Назад', 'Вперёд', 'Пуск', 'Стоп']);
  });

  it('the drawing tool is «Кисть», short enough to wear whole', () => {
    expect(ru.tool.pencil.label).toBe('Кисть');
    expect((ru.tool.pencil as Record<string, string>).short).toBeUndefined();
    expect(toolKey).not.toContain('shortName');
  });

  // The names hang 0.5rem + 3px under the bar and the zoom window stood
  // 0.5rem under it, in the same corner: the names lay on its keys.
  it('the zoom window in the corner stands under the names while they are worn', () => {
    expect(editorUi).toMatch(/\.studio\.compact\.named \.stage\.zoom-corner \{\s*--zoom-inset: calc\(0\.5rem \+ 3px \+ 0\.7rem \+ 0\.4rem\);/);
  });
});

describe('undo and redo in a phone’s row over the canvas', () => {
  // Lying down they were 42.4 px wide: the row took its 3 px from the two
  // keys that could shrink.
  it('stand on the tap floor: the row does not squeeze them', () => {
    expect(editorUi).toMatch(/\.studio\.compact \.top \.history \{\s*flex: none;\s*\}/);
    expect(editorUi).toMatch(/\.studio\.compact \.top \.history :global\(\.key\) \{\s*min-width: var\(--tap\);/);
  });
});

describe('the sound’s key says a track is attached', () => {
  // With a track and without, the key looked the same; only its title knew.
  it('the key wears the accent’s ink while the toon has a track', () => {
    expect(editorUi).toMatch(/class:active=\{audioOpen\}\s*class:has-track=\{editor\.audio\.hasTrack\}/);
    expect(editorUi).toMatch(/\.layers > \.key\.has-track \{\s*color: var\(--accent-ink\);/);
  });
});

describe('the frame’s menu under a finger', () => {
  // «A / Del / C / V / M» beside the items of a menu opened by a held finger:
  // keys the phone does not have.
  it('names no keyboard keys where no pointer is fine', () => {
    expect(timeline).toMatch(/@media not all and \(any-pointer: fine\) \{\s*\.frame-menu kbd \{\s*display: none;/);
  });
});

describe('a step of one frame is not drawn as «play»', () => {
  // «Следующий кадр» and «Проиграть» were the same triangle at two sizes.
  // The transport's own convention: a step is a triangle at a bar, an end of
  // the strip — two triangles at a bar.
  it('the step wears a bar, the ends two triangles', () => {
    for (const name of ['frame-prev', 'frame-next']) {
      expect(path(name).match(/M/g)?.length).toBe(2);
      expect(path(name)).toMatch(/^M\d+ 6v12M/);
    }
    for (const name of ['frame-first', 'frame-last']) expect(path(name).match(/Z/g)?.length).toBe(2);
    expect(new Set(['play', 'frame-prev', 'frame-next', 'frame-first', 'frame-last'].map(path)).size).toBe(5);
  });
});

// A phone's browser keeps its bars, and the site its header, over a sheet with
// little room as it is (owner, 2026-10-08). The first touch takes the screen.
describe('a phone goes full screen on the first touch', () => {
  it('once a visit, for a finger on a phone-size studio, on release', () => {
    expect(editorUi).toContain('onpointerupcapture={fullOnFirstTouch}');
    const body = editorUi.slice(editorUi.indexOf('function fullOnFirstTouch'), editorUi.indexOf('* A sheet over a full-screen editor'));
    expect(body).toContain("if (wentFull || !compact || e.pointerType !== 'touch') return;");
    expect(body).toContain('wentFull = true;');
    // An iPhone has no full screen: nothing is asked for, nothing throws.
    expect(body).toContain('if (document.fullscreenEnabled && !document.fullscreenElement) void editorEl.requestFullscreen().catch(() => {});');
  });
});

// On a 412 px phone the row holds more tools, and «Перо», «Мега-ластик» and
// «Трансформация» ran into one word (owner, 2026-10-08, a Galaxy A51).
it('a first visit names the brush and the eraser, not every tool in the row', () => {
  expect(editorUi).toMatch(/\.studio\.compact\.named \.top :global\(\.key\[data-tool\]:not\(\[data-tool='pencil'\], \[data-tool='eraser'\]\)\)::after \{\s*content: none;/);
});

// A tablet is laid out as the desktop, where a key is named by the tooltip the
// cursor brings — and a tablet has no cursor (owner, 2026-10-08: «почему на
// ipad нет подписей?»). Its first visit names the keys it starts with.
it('with no cursor to hover with, the wide row names send, brush, eraser and colours', () => {
  expect(editorUi).toContain("const noHover = matchMedia('(hover: none)').matches;");
  expect(editorUi).toContain('class:fingers={noHover}');
  expect(editorUi).toContain(".studio.fingers.named:not(.compact) .top :global(:is(.key.publish, .key[data-walk], .key[data-tool='pencil'], .key[data-tool='eraser']))::after {");
  expect(editorUi).toContain("attrs={{ 'data-walk': '' }}");
});

// Lying down the site puts its header away — 56 px of a 360 px screen go to
// the sheet (owner, 2026-10-08). The way back to the site is a key behind «⋯».
it('lying down «⋯» holds the host\'s way home', () => {
  expect(editorUi).toContain('home?: { href: string; label: string };');
  expect(editorUi).toContain("{#if group.id === 'studio' && home}<a class=\"key\" href={home.href} aria-label={home.label}>");
});

// The hub and «Новый мульт» stand in place of the studio, over its «⋯» too:
// with the host's header put away there was no way out of them (owner,
// 2026-10-08). Both heads hold the same way home.
it('lying down the hub and the new-toon screen hold the way home too', async () => {
  const hub = await Bun.file(new URL('./DraftsHub.svelte', import.meta.url)).text();
  expect(editorUi).toContain('      {home}\n');
  expect(hub.match(/\{#if home\}<a class="key" href=\{home\.href\}>\{home\.label\}<\/a>\{\/if\}/g)?.length).toBe(2);
});
