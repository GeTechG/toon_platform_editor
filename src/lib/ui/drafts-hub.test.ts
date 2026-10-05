import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// The drafts hub (owner, 2026-10-05): the studio opens on its drafts the way
// Procreate Dreams opens on its Theater — a screen of cards, «Выбрать» for the keys that act on several. Read as source, like the
// audits: the look is checked live.
const UI = new URL('./', import.meta.url).pathname;
// The hub is its own component; what reads and writes storage or replaces the
// drawing stays with the editor (`studio`).
const shell = await Bun.file(UI + 'DraftsHub.svelte').text();
const studio = await Bun.file(UI + 'Editor.svelte').text();
const rule = (selector: string) => {
  const at = shell.indexOf(`${selector} {`);
  return at < 0 ? '' : shell.slice(at, shell.indexOf('}', at));
};
const fn = (name: string) => {
  const from = shell.includes(`function ${name}(`) ? shell : studio;
  const at = from.indexOf(`function ${name}(`);
  expect(at).toBeGreaterThan(-1);
  return from.slice(at, from.indexOf('\n  }\n', at));
};

describe('the hub stands in place of the studio', () => {
  // Owner, 2026-10-05, third time asked: inside the editor, not over the
  // screen — the site's header stays in sight and at work, nothing is dimmed.
  it('fills the editor box and no more', () => {
    // Its own element and class: not a sheet with its layouts overridden.
    expect(shell).toMatch(/<dialog\s+bind:this=\{dialogEl\}\s+class="hub"/);
    expect(shell).not.toContain('sheet-dialog');
    const hub = rule('.hub');
    expect(hub).toMatch(/position:\s*absolute/);
    expect(hub).toMatch(/inset:\s*0/);
    expect(hub).not.toMatch(/100dv[wh]/);
    // A <dialog> is `height: fit-content`: one card made a strip of it.
    expect(hub).toMatch(/height:\s*auto/);
    expect(hub).toMatch(/background:\s*var\(--paper\)/);
  });

  it('is not modal, so the page around the studio stays alive', () => {
    expect(shell).toContain('hub.show();');
    expect(shell).not.toMatch(/\.showModal\(\)/);
  });

  it('the studio under it is out of reach of Tab and of the keys', () => {
    expect(shell).toMatch(/child\.inert = true/);
    expect(studio).toContain("const SHEET_UP = 'dialog:modal, dialog.hub[open]';");
    expect(studio.match(/document\.querySelector\(SHEET_UP\)/g)?.length).toBe(2);
    expect(studio).not.toContain("document.querySelector('dialog:modal')");
  });

  it('Esc leaves it as the close key does', () => {
    expect(shell).toMatch(/onkeydown=\{\(e\) => \{\s*if \(e\.key === 'Escape'\) \{\s*e\.stopPropagation\(\);\s*leaveHub\(\);/);
  });

  it('lays the drafts out as cards that fill the row', () => {
    expect(rule('.drafts')).toMatch(/grid-template-columns:\s*repeat\(auto-fill, minmax\(/);
  });

  it('a card is its still, large, with the words under it', () => {
    expect(rule('.draft-open')).toMatch(/flex-direction:\s*column/);
    expect(rule('\n  .draft-thumb')).toMatch(/aspect-ratio:\s*16 \/ 9/);
  });
});

describe('the choice of a sheet comes after the drafts', () => {
  // Owner, 2026-10-05: on a desktop the «+» in the far corner was a trip of
  // the mouse across an empty screen. It is the first card of the grid now,
  // as a desktop editor's «new file» tile is — beside the drafts.
  it('«+» is the first card, before the drafts', () => {
    expect(shell).toMatch(/<ul class="drafts" class:choosing>\s*\{#if !touchHub\}\s*<li class="draft">\s*<button class="draft-open hub-new" onclick=\{\(\) => showCreate\(true\)\}>\s*<span class="draft-thumb new-thumb"><Icon name="plus" size=\{28\} \/><\/span>[^]*?\{t\('editor\.new_sheet'\)\}[^]*?<\/li>\s*\{\/if\}\s*\{#each drafts as entry/);
    expect(t('editor.create')).toBe('Создать');
    expect(t('editor.new_sheet')).toBe('Новый мульт');
  });

  it('the close key is there only over a drawing there is to go back to', () => {
    expect(shell).toMatch(/\{#if !editor\.sheetOpen\}\s*<button class="key icon hub-close" onclick=\{leaveHub\}/);
  });

  it('Esc over a clean sheet shows the sheets; over a drawing, or from the sheets, it closes', () => {
    expect(fn('leaveHub')).toMatch(/if \(!creating && editor\.sheetOpen\) \{\s*void showCreate\(true\);\s*\} else \{\s*dialogEl\?\.close\(\);/);
  });

  it('a drawing on the canvas is written before the new one takes its place, and asked about only when that failed', () => {
    // The editor starts the sheet and says whether it did; the hub closes on a yes.
    const body = fn('startSheet');
    expect(body).toMatch(/if \(!editor\.sheetOpen\) \{/);
    expect(body).toMatch(/await saveNow\(true\)/);
    expect(body).toContain("confirm(t('editor.new_sheet_lost_confirm'))");
    expect(body).toMatch(/editor\.newSheet\(\)[^]*draftId = newDraftId\(\)[^]*editor\.setSheet\(value\);\s*return true;/);
    expect(fn('pickSheet')).toMatch(/if \(await onSheet\(value\)\) \{\s*dialogEl\?\.close\(\);/);
    expect(studio).toContain('onSheet={startSheet}');
  });

  // Owner, 2026-10-05: eight cards alike said nothing. A card is a proportion,
  // the resolution stands beside, the side the sheet lies on is a checkbox.
  it('a card is a proportion, drawn as the sheet would lie', () => {
    expect(shell).toMatch(/\{#if creating\}[^]*?\{#each sheetProportions\(\) as proportion \(proportion\)\}[^]*?onclick=\{\(\) => \(newProportion = proportion\)\}/);
    expect(shell).toContain('aria-pressed={proportion === newProportion}');
    expect(shell).toContain('style:aspect-ratio="{shape.width} / {shape.height}"');
  });

  it('the resolution is a column of keys beside the cards', () => {
    expect(shell).toMatch(/\{#each sheetSizes\(\) as size \(size\)\}[^]*?aria-pressed=\{size === newSize\} onclick=\{\(\) => \(newSize = size\)\}/);
    expect(rule('.sheet-new')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) /);
  });

  // Owner, 2026-10-05: four in a row left the screen empty under them.
  it('the proportions stand two by two', () => {
    expect(rule('.sheet-new .drafts')).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('standing is a checkbox, and a square has no use for it', () => {
    expect(shell).toMatch(/<input type="checkbox" bind:checked=\{newStanding\} disabled=\{newProportion === '1:1'\} \/>/);
  });

  it('«Рисовать» starts the drawing on the sheet put together', () => {
    expect(shell).toContain('const newChoice = $derived(sheetOf(newProportion, newSize, newStanding));');
    expect(shell).toMatch(/class="key primary" onclick=\{\(\) => pickSheet\(newChoice\.value\)\}>\{t\('sheet\.start'\)\}/);
    expect(t('sheet.start')).toBe('Рисовать');
  });

  it('opens on the sheet the drawing has now', () => {
    expect(fn('showCreate')).toMatch(/sheetValue\(editor\.doc\)[^]*newProportion = [^]*newSize = [^]*newStanding = /);
  });

  it('an arrow left of the title returns to the drafts, and the focus goes with the view', () => {
    expect(shell).toMatch(/<span class="hub-title">\s*\{#if !touchHub\}\s*<button class="key icon" onclick=\{\(\) => showCreate\(false\)\} title=\{t\('editor\.back_to_drafts'\)\} aria-label=\{t\('editor\.back_to_drafts'\)\}>\s*<Icon name="arrow-left" \/>\s*<\/button>\s*\{\/if\}\s*<h2>\{t\('editor\.new_sheet'\)\}<\/h2>/);
    expect(fn('showCreate')).toMatch(/await tick\(\)[^]*?\.focus\(\)/);
  });
});

describe('the hub is laid out for a desktop too', () => {
  // The same owner's note: nothing to cross the screen for.
  it('stands in a column in the middle, not from edge to edge', () => {
    const column = rule('.hub > *');
    expect(column).toMatch(/max-width:\s*60rem/);
    expect(column).toMatch(/margin-inline:\s*auto/);
  });

  it('the keys stand by the title, over the cards they act on', () => {
    expect(rule('.hub-head')).toMatch(/justify-content:\s*flex-start/);
  });

  it('«Выбрать» is for a finger: under a cursor the checkbox does it', () => {
    expect(shell).toMatch(/<button class="key hub-select" onclick=\{\(\) => \(selecting = true\)\}>/);
    expect(shell).toMatch(/@media \(hover: hover\) \{\s*\.hub \.hub-keys \.hub-select \{\s*display: none;/);
  });

  it('a delete does not take the «+» card for a draft', () => {
    expect(fn('refocus')).toContain("'.draft-open:not(.hub-new)'");
  });
});

describe('a mouse picks a card without a mode', () => {
  // Dreams is made for a finger; under a cursor the card shows its checkbox.
  it('every card carries a checkbox, named by its date', () => {
    expect(shell).toMatch(/<label class="draft-pick">\s*<input\s+type="checkbox"\s+checked=\{picked\.includes\(entry\.id\)\}\s+onchange=\{\(\) => pick\(entry\)\}\s+aria-label=\{t\('editor\.draft_pick', \{ date \}\)\}/);
  });

  it('it shows under the cursor, on focus and once anything is picked', () => {
    // A reveal by `visibility`, not a fade of the whole control (control-floor).
    expect(rule('.draft-pick')).toMatch(/visibility:\s*hidden/);
    expect(shell).toMatch(/@media \(hover: hover\) \{\s*\.draft:hover \.draft-pick \{/);
    expect(shell).toContain('.draft:focus-within .draft-pick,');
    expect(shell).toContain('.drafts.choosing .draft-pick {');
  });

  it('the first pick is the mode: the keys come, a press on a card picks', () => {
    expect(shell).toContain('const choosing = $derived(selecting || picked.length > 0);');
    expect(shell).toMatch(/\{#if choosing\}\s*<button class="key icon" onclick=\{copyPicked\}/);
  });
});

describe('«Выбрать» turns the cards into a choice', () => {
  it('a card pressed while choosing is picked, not opened', () => {
    expect(shell).toContain('onclick={() => (choosing ? pick(entry) : openDraft(entry))}');
    expect(shell).toContain('aria-pressed={choosing ? picked.includes(entry.id) : undefined}');
  });

  it('copy, download and delete act on what is picked and wait for a pick', () => {
    for (const act of ['copyPicked', 'downloadPicked', 'removePicked']) {
      expect(shell).toMatch(new RegExp(`onclick=\\{${act}\\}\\s+disabled=\\{picked\\.length === 0\\}`));
    }
    // The hub hands the pick over; the editor reads and writes the storage.
    expect(shell).toContain('const downloadPicked = () => onDownload(picked);');
    expect(fn('downloadDrafts')).toContain('exportDrafts(ids)');
    expect(fn('removeDrafts')).toMatch(/askDelete\(/);
    expect(fn('removePicked')).toMatch(/if \(await onRemove\(picked\)\) \{\s*await refocus\(at\);/);
  });

  it('closing the hub ends the choice', () => {
    // The choice lives in the hub and goes with it.
    expect(shell).toContain('onclose={onClose}');
    expect(studio).toMatch(/\{#if draftsOpen\}\s*<DraftsHub[^]*?onClose=\{\(\) => \(draftsOpen = false\)\}/);
    expect(studio).not.toMatch(/let (selecting|picked|creating)\b/);
  });

  it('a draft gone from the list is not left picked', () => {
    expect(shell).toMatch(/\$effect\(\(\) => \{\s*if \(picked\.some\(\(id\) => !drafts\.some\(\(d\) => d\.id === id\)\)\) \{\s*picked = picked\.filter\(/);
  });
});

describe('under a finger and on a small screen the hub is Dreams’ Theater', () => {
  // Owner, 2026-10-05: on phones, tablets and small screens — Dreams as it is.
  it('knows a finger and a small screen', () => {
    expect(shell).toContain("coarse = matchMedia('(hover: none)').matches;");
    expect(shell).toContain('const touchHub = $derived(compact || coarse);');
    expect(shell).toMatch(/class="hub"\s+class:touch=\{touchHub\}/);
  });

  it('the title on the left, «Выбрать» and a round «+» on the right', () => {
    expect(shell).toMatch(/\{#if touchHub\}\s*<button class="key primary icon hub-new" onclick=\{\(\) => showCreate\(true\)\} title=\{t\('editor\.create'\)\} aria-label=\{t\('editor\.create'\)\}>\s*<Icon name="plus" \/>/);
    expect(rule('.hub.touch .hub-head')).toMatch(/justify-content:\s*space-between/);
  });

  it('a card’s words stand under the middle of its still', () => {
    expect(rule('.touch .draft-meta')).toMatch(/text-align:\s*center/);
  });

  it('the new drawing is cancelled from the right', () => {
    expect(shell).toMatch(/\{#if touchHub\}\s*<button class="key" onclick=\{\(\) => showCreate\(false\)\}>\{t\('transform\.cancel'\)\}<\/button>/);
  });

  it('the proportions are a reel: one card a screen, swiped up and down', () => {
    expect(shell).toMatch(/<div class="hub-body reel" bind:this=\{reelEl\} onscroll=\{onReel\}>/);
    const reel = rule('.hub .reel');
    expect(reel).toMatch(/overflow-y:\s*auto/);
    expect(reel).toMatch(/scroll-snap-type:\s*y mandatory/);
    expect(rule('.reel-card')).toMatch(/scroll-snap-align:\s*center/);
    expect(rule('.reel-card')).toMatch(/height:\s*100%/);
  });

  // Owner, 2026-10-05, with Dreams' own screen beside ours: the card *is* the
  // sheet — a light plate in its proportion — and holds only the size chip,
  // the name and the way on. A sheet drawn inside a card was «очень плохо».
  it('the card is the sheet: a plate in its proportion, as large as the screen lets', () => {
    const card = shell.match(/<section class="reel-card"[^]*?<\/section>/)?.[0] ?? '';
    expect(card).toContain('style:--r={shape.width / shape.height}>');
    expect(card).not.toContain('<svg');
    expect(rule('.reel-card')).toMatch(/container-type:\s*size/);
    const plate = rule('.reel-plate');
    expect(plate).toMatch(/aspect-ratio:\s*var\(--r\)/);
    expect(plate).toMatch(/width:\s*min\(100cqw, calc\(86cqh \* var\(--r\)\)\)/);
    // 224×398 in a 266px page: a standing sheet on a phone lying down.
    expect(plate).toMatch(/max-height:\s*100cqh/);
  });

  // Owner, 2026-10-05: the browser's own list under the chip was «не
  // красивый». The chip opens the studio's menu, drawn as Dreams draws its.
  it('the size is a chip that opens a menu of the sizes with their pixels', () => {
    const card = shell.match(/<section class="reel-card"[^]*?<\/section>/)?.[0] ?? '';
    expect(card).not.toContain('<select');
    expect(card).toMatch(/<button\s+class="reel-size"\s+aria-haspopup="menu"\s+aria-expanded=\{sizeMenu !== null && proportion === newProportion\}\s+aria-label=\{t\('sheet\.size_chip', \{ size: newSize \}\)\}\s+onclick=\{\(e\) => openSizeMenu\(e\.currentTarget, proportion\)\}/);
    expect(card).toContain('<strong>{sheetName(shape.ratio)}</strong>');
    expect(card).toMatch(/class="key primary" onclick=\{\(\) => pickSheet\(shape\.value\)\}>\{t\('sheet\.start'\)\}/);
    const menu = shell.match(/<div\s+class="size-menu"[^]*?<\/div>/)?.[0] ?? '';
    expect(menu).toContain('role="menu"');
    expect(menu).toMatch(/<button role="menuitemradio" aria-checked=\{size === newSize\} onclick=\{\(\) => pickSize\(size\)\}>\s*<span>\{size\}<\/span>\s*<small>\{sheet\.width\}×\{sheet\.height\}<\/small>/);
  });

  it('the menu stands outside the reel, which would clip it, and inside the screen', () => {
    // The reel scrolls and its cards are containers: a menu inside is cut.
    expect(shell.indexOf('class="size-menu"')).toBeGreaterThan(shell.indexOf('<div class="reel-dots"'));
    expect(fn('openSizeMenu')).toMatch(/await tick\(\)[^]*Math\.min\([^]*Math\.max\(/);
    expect(rule('.hub > .size-menu')).toMatch(/position:\s*absolute/);
  });

  it('the menu opens on the size chosen, walks by arrows, and closes back to the chip', () => {
    expect(fn('openSizeMenu')).toContain("'[aria-checked=\"true\"]'");
    const keys = fn('sizeMenuKeys');
    expect(keys).toMatch(/'Escape'[^]*e\.stopPropagation\(\)/);
    expect(keys).toContain("'ArrowDown'");
    expect(keys).toContain("'ArrowUp'");
    expect(fn('closeSizeMenu')).toMatch(/from\?\.focus\(\)/);
    // A press outside it and a swipe of the reel both put it away.
    expect(shell).toMatch(/<div class="size-scrim" onclick=\{closeSizeMenu\}/);
    expect(fn('onReel')).toContain('sizeMenu = null');
  });

  it('standing is one checkbox for the whole reel, under it', () => {
    const card = shell.match(/<section class="reel-card"[^]*?<\/section>/)?.[0] ?? '';
    expect(card).not.toContain('type="checkbox"');
    expect(shell).toMatch(/<label class="sheet-stand reel-stand">\s*<input type="checkbox" bind:checked=\{newStanding\} disabled=\{newProportion === '1:1'\} \/>/);
  });

  it('dots beside the reel say which card is up', () => {
    expect(shell).toMatch(/<div class="reel-dots" aria-hidden="true">/);
    expect(fn('onReel')).toMatch(/Math\.round\(reelEl\.scrollTop \/ reelEl\.clientHeight\)/);
  });

  it('the reel opens on the proportion the sheet has', () => {
    expect(fn('showCreate')).toMatch(/reelEl\?\.scrollTo\(/);
  });
});

describe('a sheet is called by what it is for, not by its numbers', () => {
  // Owner, 2026-10-05: «16:9» says nothing to someone who came to draw.
  it('every sheet, lying and standing, has a name and a line about it', () => {
    for (const ratio of ['16_9', '4_3', '1_1', '21_9', '9_16', '3_4', '9_21']) {
      expect(t(`sheet.name_${ratio}`)).not.toContain('sheet.');
      expect(t(`sheet.about_${ratio}`)).not.toContain('sheet.');
    }
    expect(t('sheet.name_16_9')).toBe('Широкий экран');
    expect(t('sheet.name_9_16')).toBe('Вертикальное видео');
  });

  it('the card and the reel show the name; the numbers stand by in small', () => {
    expect(shell).toContain('<span class="draft-date">{sheetName(shape.ratio)}</span>');
    expect(shell).toContain('<span class="draft-size">{shape.ratio} · {shape.width}×{shape.height}</span>');
    expect(shell).toContain('<p class="reel-about">{sheetAbout(shape.ratio)}</p>');
  });

  // Owner, 2026-10-05: the line was dropped under 12rem of plate — a 16:9
  // plate on a phone standing, where it fits with room to spare. It is always
  // there: a plate too low for it grows to hold it, the proportion gives way.
  it('the line about a sheet is always shown; a low plate grows to hold it', () => {
    expect(shell).not.toMatch(/\.reel-about \{\s*display: none/);
    const plate = rule('.reel-plate');
    // Size containment and a clip both take the content's floor away.
    expect(plate).not.toMatch(/container-type|overflow:\s*hidden|min-height/);
  });

  it('a long name breaks inside a narrow plate', () => {
    expect(rule('.reel-name')).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe('a standing sheet on a phone lying down', () => {
  // Owner, 2026-10-05: «вертикальные на горизонтальном не влазят». In a page
  // 13rem high a 9:16 plate with a chip and a key inside came out 224×206 —
  // every standing sheet the same squat plate. There the sheet is drawn in
  // its own proportion and the words stand beside it.
  it('the words are one group, so they can step out of the plate together', () => {
    expect(shell).toMatch(/<div class="reel-plate" class:beside=\{shape\.width < shape\.height\} style:--r=\{shape\.width \/ shape\.height\}>\s*<div class="reel-words">/);
  });

  it('a low page draws a standing sheet bare, as a sample, and puts the words beside it', () => {
    expect(rule('.reel-card')).toMatch(/container-name:\s*reel/);
    const low = shell.slice(shell.indexOf('@container reel (max-height: 20rem) {'));
    expect(low.indexOf('.reel-plate.beside {')).toBeGreaterThan(-1);
    const plate = low.slice(low.indexOf('.reel-plate.beside {'), low.indexOf('}', low.indexOf('.reel-plate.beside {')));
    expect(plate).toMatch(/flex-direction:\s*row/);
    expect(plate).toMatch(/background:\s*none/);
    // No size of its own to hold: it is as wide as the sheet and the words.
    expect(plate).toMatch(/container-type:\s*normal/);
    const sheet = low.slice(low.indexOf('.reel-plate.beside::before {'), low.indexOf('}', low.indexOf('.reel-plate.beside::before {')));
    expect(sheet).toMatch(/aspect-ratio:\s*var\(--r\)/);
    expect(sheet).toMatch(/width:\s*min\(50cqw, calc\(92cqh \* var\(--r\)\)\)/);
  });
});

// The audit of 2026-10-05: the hub's layout was the studio's, its finish in
// places Dreams' — ink for a ground, radii and sizes of its own, a «+» tile
// drawn anew beside the one the site already has.
describe('the hub is dressed in the studio’s own surfaces', () => {
  const hubCss = shell.slice(shell.indexOf('<style>'));

  it('ink is nobody’s ground here: the chip and its menu are paper and tone', () => {
    // DESIGN §2: ink works as a ground on the Stage only.
    expect(hubCss).not.toMatch(/background:[^;]*var\(--ink\)/);
    expect(rule('.reel-size')).toMatch(/background:\s*var\(--sub\)/);
    // Owner, 2026-10-05: no soft shadow — «у нас минимализм». The menu is
    // told from the card and from the paper by tone alone: the chip's own
    // tone, a step under both, with the size chosen lifted to the canvas.
    const menu = rule('.hub > .size-menu');
    expect(menu).toMatch(/background:\s*var\(--sub\)/);
    expect(menu).not.toMatch(/box-shadow|border:/);
    expect(menu).toMatch(/border-radius:\s*var\(--r-md\)/);
    const chosen = rule(".size-menu button[aria-checked='true']");
    expect(chosen).toMatch(/background:\s*var\(--canvas\)/);
    expect(chosen).toMatch(/color:\s*var\(--accent-ink\)/);
  });

  it('mixes no colour from a token: Safari 16.0 computes that to nothing', () => {
    expect(hubCss).not.toContain('color-mix(');
  });

  it('every corner is a rung of the ladder', () => {
    const corners = [...hubCss.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]);
    expect(corners.filter((value) => !/^(0|50%|var\(--r-(sm|md|lg|xl|pill)\))$/.test(value))).toEqual([]);
  });

  it('«Новый мульт» is the tile the site already has, not a new one', () => {
    const tile = rule('.draft-open.hub-new');
    expect(tile).toMatch(/background:\s*var\(--tile\)/);
    expect(tile).toMatch(/color:\s*var\(--tile-ink\)/);
    expect(hubCss).not.toContain('dashed');
  });

  it('a draft is a plate with its still in a well, as a card of the feed is', () => {
    const card = rule('.draft-open');
    expect(card).toMatch(/background:\s*var\(--canvas\)/);
    expect(card).toMatch(/border-radius:\s*var\(--r-xl\)/);
    const still = rule('\n  .draft-thumb');
    expect(still).toMatch(/background:\s*var\(--well\)/);
    expect(still).toMatch(/border-radius:\s*var\(--r-lg\)/);
  });

  it('the words are the studio’s ink-blue, not the sheet’s black', () => {
    expect(rule('.hub')).toMatch(/color:\s*var\(--text\)/);
    expect(hubCss).not.toContain('var(--ink-2)');
    expect(rule('.draft-size')).toMatch(/color:\s*var\(--text-2\)/);
  });

  it('the sizes are steps of the scale, the numbers stand in columns', () => {
    // Card: 800, 1.6rem, -0.02em. Title: 750, 1.14rem.
    expect(rule('.hub-head h2')).toMatch(/font-size:\s*1\.6rem;\s*font-weight:\s*800;/);
    expect(rule('.reel-name')).toMatch(/font-size:\s*1\.6rem/);
    expect(rule('.reel-size')).toMatch(/font-size:\s*1\.14rem/);
    expect(rule('.draft-size')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('one drawing of a sheet: white on the paper, in the cards and in the reel', () => {
    expect(rule('.draft-thumb.sheet-shape')).toMatch(/background:\s*var\(--paper\)/);
  });
});

describe('the hub says what it is and where it is', () => {
  it('the window is named by the view it shows', () => {
    expect(shell).toContain("aria-label={creating ? t('editor.new_sheet') : t('editor.drafts')}");
  });

  it('the dots of the reel can be seen: the edge, not the hairline', () => {
    expect(rule('.reel-dots span')).toMatch(/background:\s*var\(--edge\)/);
  });

  it('a card of the reel that is not up is out of the way of Tab', () => {
    expect(shell).toContain('<section class="reel-card" aria-label={sheetName(shape.ratio)} inert={proportion !== newProportion}>');
  });
});
