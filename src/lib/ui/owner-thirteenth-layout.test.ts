import { describe, expect, it } from 'bun:test';
import { pickStep, type Room } from './small-screen';
import { FIT_PADDING, fitSheet, fitView, resizedView, type Cover, type Stage } from './viewport';

// Owner's answers after the thirteenth audit, the layout part: the sheet at
// 100 % lies clear of what stands over the stage, a phone lying down takes the
// compact step, and the brush boxes trim by the studio's step, not a width query.
const UI = new URL('./', import.meta.url).pathname;
const canvas = await Bun.file(UI + 'CanvasView.svelte').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const brushPanel = await Bun.file(UI + 'BrushPanel.svelte').text();
const brushSizes = await Bun.file(UI + 'BrushSizes.svelte').text();
const transformMenu = await Bun.file(UI + 'TransformMenu.svelte').text();
const layerRows = await Bun.file(UI + 'LayerRows.svelte').text();
const timeline = await Bun.file(UI + 'Timeline.svelte').text();

const DOC = { width: 1280, height: 720 };

function overlaps(a: Cover, b: Cover): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function stageOf(width: number, height: number, covers: Cover[] = []): Stage {
  const sheet = fitSheet(width, height, DOC, covers);
  return { width, height, sheetWidth: sheet.width, sheetHeight: sheet.height, sheetX: sheet.x, sheetY: sheet.y };
}

describe('the sheet at 100 % lies clear of what stands over the stage', () => {
  // 390×844, the phone step: the stage is 330×738, the rail 44 wide at 20 px
  // from its left edge, the zoom window in the top right corner.
  const rail = { x: 20, y: 241, width: 44, height: 256 };
  const zoom = { x: 183, y: 9, width: 139, height: 48 };

  it('without covers it is the old fit, centred', () => {
    const sheet = fitSheet(330, 738, DOC);
    expect(sheet.width).toBe(330 - 2 * FIT_PADDING);
    expect(sheet.x).toBe(FIT_PADDING);
    expect(sheet.y).toBeCloseTo((738 - sheet.height) / 2);
  });

  it('the thickness rail takes its strip off the left, with the air after it', () => {
    const sheet = fitSheet(330, 738, DOC, [rail, zoom]);
    const place = { x: sheet.x, y: sheet.y, width: sheet.width, height: sheet.height };
    expect(overlaps(place, rail)).toBe(false);
    expect(overlaps(place, zoom)).toBe(false);
    expect(sheet.x).toBeGreaterThanOrEqual(rail.x + rail.width + FIT_PADDING);
    // Cut from the edge the rail stands on, not from under it: the sheet
    // stays in the middle of the height, as wide as the rest allows.
    expect(sheet.width).toBeCloseTo(330 - (rail.x + rail.width) - 2 * FIT_PADDING);
    expect(sheet.y + sheet.height / 2).toBeCloseTo(738 / 2);
  });

  it('a cover the fitted sheet does not reach costs it nothing', () => {
    // The desktop's zoom window, bottom left, under a wide sheet.
    const plain = fitSheet(891, 649, DOC);
    const sheet = fitSheet(891, 649, DOC, [{ x: 20, y: 581, width: 150, height: 48 }]);
    expect(sheet).toEqual(plain);
  });

  it('a phone lying down keeps the sheet between the rail and the zoom window', () => {
    const covers = [
      { x: 20, y: 72, width: 44, height: 208 },
      { x: 525, y: 16, width: 139, height: 48 },
    ];
    const sheet = fitSheet(680, 304, DOC, covers);
    const place = { x: sheet.x, y: sheet.y, width: sheet.width, height: sheet.height };
    for (const cover of covers) expect(overlaps(place, cover)).toBe(false);
    expect(sheet.width).toBeGreaterThan(400);
  });

  it('a cover of no size (the rail hidden for a mouse) is not there', () => {
    expect(fitSheet(330, 738, DOC, [{ x: 20, y: 0, width: 0, height: 0 }])).toEqual(fitSheet(330, 738, DOC));
  });

  it('100 % puts the sheet where the fit laid it; a turn keeps a fitted sheet fitted', () => {
    const phone = stageOf(330, 738, [rail, zoom]);
    expect(fitView(phone)).toEqual({ zoom: 1, panX: phone.sheetX!, panY: phone.sheetY! });
    const lying = stageOf(680, 304, [{ x: 20, y: 72, width: 44, height: 208 }]);
    const view = resizedView(fitView(phone), phone, lying);
    expect(view.panX).toBeCloseTo(fitView(lying).panX);
    expect(view.panY).toBeCloseTo(fitView(lying).panY);
  });

  it('the canvas measures what stands over the stage and fits around it', () => {
    expect(canvas).toMatch(/fitSheet\([^)]*covers/);
    expect(canvas).toMatch(/class="size-rail"[^>]*data-over-sheet|data-over-sheet[^>]*\n?\s*class="size-rail"/);
    expect(editorUi).toMatch(/class="scale-window" data-over-sheet/);
  });

  it('the rail counts the safe area once: the editor already stands clear of it', () => {
    const rule = canvas.match(/\n  \.size-rail \{[^}]*\}/)![0];
    expect(rule).not.toContain('safe-area-inset-left');
  });
});

describe('a phone lying down takes the compact step', () => {
  // What Editor.svelte measures at 100 % text: the columns 8.4 + 15.9 rem,
  // the bottom bar ~151 px; the tablet's column beside a one-line dock.
  function step(w: number, h: number, current: 'full' | 'phone' = 'full') {
    const full: Room = { w: w - 389, h: h - 151 };
    const tablet: Room = { w: w - 134, h: h - 56 };
    return pickStep(current, { full, tablet }, { w, h });
  }

  it('740×360 and 844×390 draw on the whole screen', () => {
    expect(step(740, 360)).toBe('phone');
    expect(step(844, 390)).toBe('phone');
  });

  it('1024×768 and 1280×800 stay the desktop, from either side', () => {
    expect(step(1024, 768)).toBe('full');
    expect(step(1280, 800)).toBe('full');
    expect(step(1024, 768, 'phone')).toBe('full');
  });
});

describe('the brush boxes and the rest trim by the studio’s step', () => {
  for (const [name, source] of [
    ['BrushPanel', brushPanel],
    ['BrushSizes', brushSizes],
    ['TransformMenu', transformMenu],
    ['LayerRows', layerRows],
    ['Timeline', timeline],
  ] as const) {
    it(`${name} has no width query for its layout`, () => {
      expect(source).not.toMatch(/@media \((max|min)-width/);
      expect(source).not.toContain("matchMedia('(max-width");
    });
  }

  it('the phone step trims the boxes; the zoom row shows where the zoom window hides', () => {
    expect(brushPanel).toContain(':global(:where(.studio.phone)) .');
    expect(brushSizes).toContain(':global(:where(.studio.phone)) .');
    expect(transformMenu).toContain(':global(:where(.studio.compact)) .row.zoom {');
    expect(transformMenu).toContain(".closest('.studio.compact')");
  });
});

describe('a phone’s layer row fits its column', () => {
  // 360×740: the row asked 155 px of a 137 px column at 100 % text, 251 of 95
  // at 200 %, and the bin went off into a sideways scroll.
  const phoneRows = layerRows.slice(layerRows.indexOf(':global(:where(.studio.phone)) '));
  const phoneStrip = timeline.slice(timeline.indexOf(':global(:where(.studio.phone)) '));

  it('the name gives way before the keys do', () => {
    expect(phoneRows).toMatch(/\.name \{[^}]*min-width: 0/);
  });

  it('the column is never narrower than the keys of its row', () => {
    // Eye, handle and bin (1rem + 8px each), the 14 px tag and its 1 px
    // margins, four 4 px gaps, 3 + 3 padding and the column's border.
    expect(phoneStrip).toMatch(/\.layer-col \{[^}]*min-width: calc\(3rem \+ 63px\)/);
    expect(phoneStrip).toMatch(/\.body \{[^}]*container: strip \/ inline-size/);
  });

  it('where the keys would take more than half the strip, the drag handle folds away', () => {
    const narrow = /@container strip \(width < calc\(6rem \+ 126px\)\)/;
    expect(layerRows).toMatch(new RegExp(narrow.source + String.raw`\s*\{[^]*?\.handle \{\s*display: none`));
    expect(timeline).toMatch(new RegExp(narrow.source + String.raw`\s*\{[^]*?\.layer-col \{\s*min-width: calc\(2rem \+ 51px\)`));
  });

  it('there «+ Слой» keeps its plus and its name, the word only for the reader', () => {
    expect(layerRows).toContain('<Icon name="plus" size={16} /> <span class="add-word">{t(\'layer.add\')}</span>');
    const narrow = layerRows.slice(layerRows.indexOf('@container strip'));
    expect(narrow).toMatch(/\.add-word \{[^}]*clip-path: inset\(50%\)/);
  });
});

describe('the brush box keeps its «i» inside at 200 % text', () => {
  it('the title is its own item that breaks, the key does not shrink', () => {
    expect(brushPanel).toContain('<span class="field-title">{title}</span>');
    const title = brushPanel.match(/\n  \.field-title \{[^}]*\}/)![0];
    expect(title).toContain('min-width: 0');
    expect(title).toContain('overflow-wrap: anywhere');
    expect(brushPanel).toMatch(/\n  \.field \{[^}]*display: flex/);
    expect(brushPanel).toMatch(/\n  \.field \.info \{[^}]*flex: none;[^}]*width: max\(44px, 1\.75rem\)/);
  });
});
