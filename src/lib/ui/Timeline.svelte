<script lang="ts">
  // The reference toonio.ru timeline (`Timeline` in toonio.bundle.js:8645):
  // the layer list on the left and a layer-by-frame grid of cell thumbnails
  // on the right, filling whatever height the resizable bottom panel gives
  // it. One shape for every preset — a preset patches where the strip sits,
  // not what it is.
  import { tick, untrack } from 'svelte';
  import type { Frame, Layer } from '../format/types';
  import type { EditorState } from './editor-state.svelte';
  import { CELL_BOX, cellSize, rowHeight, rowHeightCss } from './thumb-size';
  import { numberEvery, scrollToFrame, stripLevel, stripTabStop, stripTail, stripWindow, wheelOnStrip, zoomBy, zoomScroll, ZOOM_MAX, ZOOM_MIN } from './strip-window';
  import {
    carryTarget,
    framesToCarry,
    frameMenuTop,
    onScrollbar,
    selectionSpan,
    stepColumn,
    type FrameMenuAction,
  } from './frame-selection';
  import LayerRows from './LayerRows.svelte';
  import LayerThumb from './LayerThumb.svelte';
  import Icon from './Icon.svelte';
  import { createLostRelease, mainUp } from './lost-release';
  import { keyOf } from '../model/cells';
  import { t } from '../i18n';
  import { notePopupClosed } from './dismiss-press';

  let { editor }: { editor: EditorState } = $props();

  // The frames or the layer that have just come: they fade in so the eye
  // finds where they landed. Found by the counts growing, not by a node being
  // built — the strip builds cells as it scrolls, and those must stand still.
  // Never under a preview: there the strip only shows which frame is up.
  // Raw: a proxy of a cell or a layer would never equal the one it stands for.
  let arrived = $state.raw<{ frames?: ReadonlySet<Frame>; layer?: Layer } | null>(null);
  let counted: { frames: number; layers: number } | null = null;
  // Where each frame stood at the last layout, by its bottom cell — a move
  // keeps the cells and renumbers them. A frame that changes place slides
  // from where it stood instead of jumping there: the neighbours of a carried
  // frame make way (Procreate Dreams, Krita), and so they do for «Сдвинуть»,
  // a delete, a duplicate, an undo.
  let placed = new Map<Frame, number>();
  let placedPitch = 0;
  /**
   * What a column is known by while the strip moves: its first drawing, top
   * to bottom of the stack. A column of continuations has none — every
   * continuation is the same null — and is not slid.
   */
  function columnKey(i: number): Frame | undefined {
    for (const layer of editor.doc.layers) {
      const cell = layer.frames[i];
      if (cell) return cell;
    }
    return undefined;
  }
  $effect(() => {
    const now = editor.cellBounds;
    const frames = Array.from({ length: editor.doc.layers[0].frames.length }, (_, i) => columnKey(i));
    const at = timing;
    const was = counted;
    const before = placed;
    const samePitch = pitch === placedPitch;
    counted = now;
    placed = new Map(frames.flatMap((cell, i) => (cell ? [[cell, at.start(i) * pitch] as const] : [])));
    placedPitch = pitch;
    if (editor.playing) {
      arrived = null;
      return;
    }
    if (!was) return;
    if (now.layers === was.layers + 1 && now.frames === was.frames) {
      arrived = { layer: untrack(() => editor.doc.layers[editor.activeLayer]) };
      return;
    }
    // A stroke rebuilds a cell and moves nothing, and a layer moved under
    // the others is all new cells in the same count: neither is a move.
    const fresh = frames.filter((cell): cell is Frame => !!cell && !before.has(cell));
    if (fresh.length > 0 && now.frames <= was.frames) return;
    if (fresh.length > 0) arrived = { frames: new Set(fresh) };
    if (samePitch) untrack(() => slide(before));
  });

  /** A slide covers a few cells at most: a frame sent across the strip arrives, it does not streak. */
  const SLIDE_REACH = 4;

  function slide(before: ReadonlyMap<Frame, number>): void {
    if (!strip || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const look = getComputedStyle(strip);
    const duration = parseFloat(look.getPropertyValue('--dur')) * 1000 || 150;
    const easing = look.getPropertyValue('--ease-out').trim() || 'ease-out';
    for (const i of built) {
      // The carried block is under the hand: it is where the hand is.
      if (carry && i >= carry.at && i < carry.at + carry.count) continue;
      const key = columnKey(i);
      const was = key && before.get(key);
      if (was === undefined) continue;
      const dx = was - timing.start(i) * pitch;
      if (dx === 0) continue;
      const from = Math.sign(dx) * Math.min(Math.abs(dx), SLIDE_REACH * pitch);
      for (const el of strip.querySelectorAll(`[data-frame="${i}"], [data-col="${i}"]`)) {
        for (const running of el.getAnimations()) if (running.id === 'slide') running.cancel();
        el.animate([{ translate: `${from}px 0` }, { translate: '0 0' }], { duration, easing, id: 'slide' });
      }
    }
  }

  let strip = $state<HTMLDivElement | undefined>();
  /**
   * The wheel over the names or the cells moves the strip (the names follow
   * it), and never the page under the studio — at either end as well
   * (owner, 2026-10-18). Ctrl+wheel over the cells zooms the strip to the
   * pointer (timeline-exposure-cells); over the names it is left alone.
   */
  function wheelAlong(e: WheelEvent): void {
    if (!strip) return;
    if (e.ctrlKey || e.metaKey) {
      if (!strip.contains(e.target as Node)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? strip.clientWidth : 1;
      zoomAt(zoomBy(cellW, e.deltaY * unit), e.clientX);
      return;
    }
    e.preventDefault();
    const by = wheelOnStrip(e, strip.scrollHeight > strip.clientHeight, strip.clientWidth);
    strip.scrollLeft += by.x;
    strip.scrollTop += by.y;
  }

  /**
   * The cells made `width` wide, the tick under `clientX` (the strip's middle
   * when none) staying under it. Kept on the device (`timelineZoom`).
   */
  function zoomAt(width: number, clientX?: number): void {
    if (!strip) return;
    const to = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, width));
    if (Math.abs(to - cellW) < 0.01) return;
    const box = strip.getBoundingClientRect();
    const x = clientX === undefined ? strip.clientWidth / 2 : clientX - box.left - strip.clientLeft;
    const toGap = to >= 14 ? GRID_GAP : 0;
    const left = zoomScroll(strip.scrollLeft, x, GRID_GAP, pitch, to + toGap);
    editor.setSetting('timelineZoom', Math.round(to * 100) / 100);
    // The row is only as long as the new pitch once it is laid out.
    void tick().then(() => {
      if (!strip) return;
      strip.scrollLeft = left;
      stripScroll = strip.scrollLeft;
    });
  }

  // --- A pinch on the strip zooms it ----------------------------------------
  // Two fingers on the cells: their spread is the cell's width, the point
  // between them stays put. One finger still scrolls and holds as before.
  const fingers = new Map<number, number>();
  let pinch: { spread: number; width: number } | null = null;

  function onPinchDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, e.clientX);
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      pinch = { spread: Math.max(8, Math.abs(a - b)), width: cellW };
      cancelLongPress();
      held = null;
    }
  }

  function onPinchMove(e: PointerEvent): boolean {
    if (!fingers.has(e.pointerId)) return false;
    fingers.set(e.pointerId, e.clientX);
    if (!pinch || fingers.size !== 2) return false;
    const [a, b] = [...fingers.values()];
    zoomAt(pinch.width * (Math.max(8, Math.abs(a - b)) / pinch.spread), (a + b) / 2);
    return true;
  }

  function onPinchUp(e: PointerEvent): void {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
  }
  let body = $state<HTMLDivElement | undefined>();

  /** Keeps the layer names level with their row of cells. */
  function syncRowScroll(e: Event): void {
    const from = e.target as HTMLElement | null;
    if (from === strip) {
      // The window of frames the strip builds follows the scroll.
      stripScroll = strip.scrollLeft;
    }
    // The menu opens by its cell and stays where it opened: a wheel or the
    // names carrying the rows away leaves it over some other cell. Its own
    // scroll — the active frame brought into view as it opened — is where
    // it was placed, and keeps it.
    if (menu?.scroll && strip && (strip.scrollLeft !== menu.scroll.left || strip.scrollTop !== menu.scroll.top)) {
      closeMenu(true, true);
    }
    const list = body?.querySelector<HTMLElement>('[data-layer-list]');
    if (!from || !list || !strip) {
      return;
    }
    // The names get the room the strip has under its last row (`stripTail`),
    // or at its end they stopped short of their cells.
    const last = [...strip.querySelectorAll<HTMLElement>('.cells')].pop();
    const rowsEnd = last ? last.getBoundingClientRect().bottom - strip.getBoundingClientRect().top - strip.clientTop + strip.scrollTop : 0;
    list.style.paddingBottom = `${stripTail(strip, rowsEnd)}px`;
    const to = from === list ? strip : from === strip ? list : null;
    if (to && Math.abs(to.scrollTop - from.scrollTop) > 1) {
      to.scrollTop = from.scrollTop;
    }
  }

  // --- The window of frames the strip builds ---------------------------------
  // The format allows 4096 frames and a row is built per layer: three hundred
  // frames on five layers is fifteen hundred buttons with a canvas inside. The
  // strip builds what is in view plus a screen either side, and two spacers
  // stand in for the rest so the scrollbar is the length it always was.
  /** The row's padding before its first cell, px (`.head`, `.cells` and `.wave`). */
  const GRID_GAP = 2;
  /** Room past the last tick, px: the end mark is dragged into it. */
  const END_ROOM = 48;
  let stripScroll = $state(0);
  let stripWidth = $state(0);

  // Keep the active frame in view (the reference list re-centers on it):
  // after add/delete/paste/hotkeys the strip scrolls just enough to show it.
  // Not during playback — the strip stays put while frames flip. A narrower
  // strip (a phone turned, larger text) is a reason too: the frame it showed
  // may now sit past its edge, and a clamped scroll fires no scroll event.
  // The film's shape and an opened draft are heard, not every write: hiding
  // a layer or a stroke replaces the document too, and the strip scrolled
  // away from where it was being looked at back to the active frame.
  $effect(() => {
    const index = editor.activeFrame;
    void editor.docOpens;
    void frameTotal;
    void filmTicks;
    void cellW;
    void stripWidth;
    if (editor.playing || !strip) return;
    untrack(() => {
      if (!strip) return;
      stripScroll = strip.scrollLeft;
      // Where the frame sits is arithmetic: its cell may not be built.
      // The row's padding is the gap, so the last frame comes in ring and all.
      const to = scrollToFrame(index, cellW, gap, strip.scrollLeft, strip.clientWidth, GRID_GAP, timing);
      if (to !== null) {
        strip.scrollLeft = to;
        stripScroll = to;
      }
    });
  });

  // Keep the active row in view too: the arrows walk the layers from the
  // canvas, and with more rows than the panel is tall the active one sat
  // under the sticky frame numbers or below the fold. The rows are the same
  // arithmetic as the frames, turned on their side, below the header.
  $effect(() => {
    const at = layerTotal - 1 - editor.activeLayer;
    void editor.docOpens;
    void row;
    void stripWidth;
    if (editor.playing || !strip) return;
    // On a phone the strip grows to its rows and the panel scrolls instead:
    // the active row (the bottom one, by default) opened under its fold.
    // The panel alone — `scrollIntoView` would scroll the host page too.
    if (strip.scrollHeight <= strip.clientHeight) {
      void tick().then(() => revealInPanel(strip?.querySelector('.cell.active')));
      return;
    }
    const head = strip.querySelector<HTMLElement>('.head')?.offsetHeight ?? 0;
    // A row grows with the text past the frame's number (`rowHeightCss`).
    const rowPx = strip.querySelector<HTMLElement>('.cells')?.getBoundingClientRect().height || row;
    const to = scrollToFrame(at, rowPx, 0, strip.scrollTop, strip.clientHeight - head);
    if (to !== null) {
      strip.scrollTop = to;
    }
  });

  /** Scrolls the nearest scrolling box below the page just enough to show `el`. */
  function revealInPanel(el: Element | null | undefined): void {
    let box = el?.parentElement;
    while (box && box !== document.body && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) {
      box = box.parentElement;
    }
    if (!el || !box || box === document.body) return;
    const at = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (at.bottom > view.bottom) box.scrollTop += at.bottom - view.bottom;
    else if (at.top < view.top) box.scrollTop -= view.top - at.top;
  }

  // The strip is one Tab stop — the active cell — and focus rides along with
  // it: when the arrows move the active cell while a cell has focus, focus
  // moves too, so the new cell's name («Кадр 5, Слой 1») is what is read.
  // After the tick: the cell may only now be built by the scroll above.
  // Not during a preview — focus would walk the strip at 12 frames a second.
  // Delete on the focused frame unmounts its cell and drops focus to <body>;
  // the cell that had it is remembered, so focus lands on the new active one.
  let lastCell: HTMLElement | null = null;
  $effect(() => {
    void editor.displayedFrame;
    void editor.activeLayer;
    const focused = document.activeElement;
    const inStrip = focused instanceof HTMLElement && focused.classList.contains('cell') && !!strip?.contains(focused);
    const dropped = focused === document.body && lastCell !== null && !lastCell.isConnected;
    if (!strip || editor.playing || !(inStrip || dropped)) {
      return;
    }
    // Not from under the frame menu: a right press on a cell outside the
    // block picks it and opens the menu, and this took the focus back off the
    // menu's first item — the arrows walked the layers under an open menu.
    void tick().then(() => {
      if (!menu) strip?.querySelector<HTMLElement>('.cell.active')?.focus();
    });
  });

  // The first visit to a continuation says, once, what it is: the sheet shows
  // a drawing the strip has no box for (design, «Новичок не понимает…»).
  $effect(() => {
    const frame = editor.activeFrame;
    const layer = editor.activeLayer;
    if (editor.playing || editor.settings.continuationTipShown) return;
    const frames = editor.doc.layers[layer]?.frames;
    if (!frames || frames[frame] !== null) return;
    untrack(() => {
      editor.canvasHint = { text: t('timeline.continuation_tip', { n: keyOf(frames, frame) + 1 }) };
      editor.setSetting('continuationTipShown', true);
    });
  });

  // --- Studio grid ----------------------------------------------------------
  // The count, not the array: a write splices the array in place, so a derived
  // array would be the same reference and the window would never rebuild.
  const frameTotal = $derived(editor.doc.layers[0].frames.length);
  // Rows top-down: row 0 is the topmost layer, matching the layer column.
  const rows = $derived(editor.doc.layers.map((_, i) => editor.doc.layers.length - 1 - i));
  const onionFrames = $derived(
    editor.showOnionSkin ? editor.onionSkinLayers.map((layer) => layer.index) : [],
  );

  function isSelected(frame: number, layer: number): boolean {
    return editor.selection.frames.includes(frame) && editor.selection.layers.includes(layer);
  }

  function onCellClick(e: MouseEvent, frame: number, layer: number): void {
    // The long press that opened the menu ends in a click: it must not
    // collapse the block the menu is about to act on.
    if (longPressed || carried) {
      longPressed = false;
      carried = false;
      return;
    }
    // Picking spans from the active cell, like Shift does: a finger has no Shift.
    const mode = e.shiftKey || picking ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'set';
    editor.selectCell(frame, layer, mode);
  }

  // --- Drag-selection -------------------------------------------------------
  // The reference drags a rectangle of cells with the button held
  // (`bundle:9111-9150`). Touch is left alone: a finger on the grid scrolls
  // the strip, which is the only way to reach a frame off screen on a phone.
  let dragging = $state(false);
  const lostCell = createLostRelease();

  // --- Picking a block by finger ---------------------------------------------
  // A finger has no Shift, and a drag on the strip scrolls it. «Выделить
  // кадры» in the frame menu turns taps into Shift+clicks: the active cell is
  // the anchor, every tap spans the block to the tapped cell, and the strip
  // still scrolls between taps. The frame menu then acts on the block;
  // «Готово» (or Escape) turns picking off and leaves the block selected.
  let picking = $state(false);
  const span = $derived(selectionSpan(editor.selection));
  const spanText = $derived.by(() => {
    const frames = t(span.from === span.to ? 'timeline.picked_one' : 'timeline.picked', span);
    return span.layers > 1 ? t('timeline.picked_layers', { frames, n: span.layers }) : frames;
  });
  /**
   * «Готово» lives inside the picking bar and goes with it: pressed, it took
   * focus down with it to <body>. Focus goes back to where picking acts.
   */
  function endPicking(): void {
    picking = false;
    strip?.querySelector<HTMLElement>('.cell.active')?.focus();
  }

  /** The bar's «Дублировать»: the frames it repeats, and the key, as the frame menu names them. */
  const duplicateTitle = $derived.by(() => {
    const text = span.from === span.to ? t('panel.item.duplicate_frame') : t('panel.item.duplicate_frames', span);
    const key = menuKey('duplicate');
    return key ? `${text} (${key.label})` : text;
  });

  /** Said on every change of a block wider than one cell — Shift+arrows included. */
  const spanned = $derived(editor.selection.frames.length > 1 || editor.selection.layers.length > 1);

  function onCellDown(e: PointerEvent, frame: number, layer: number): void {
    // Android follows its own long press with a contextmenu, not a click:
    // what the last press left must not swallow this one. Nor must a carry
    // by the number, which ends in no click on a cell.
    longPressed = false;
    carried = false;
    if (e.pointerType === 'touch' && e.isPrimary) {
      startLongPress(e, frame, layer);
      return;
    }
    // iPadOS sends no contextmenu for a held Pencil either: the hold opens
    // the menu, and the pen still drags a block like the mouse.
    if (e.pointerType === 'pen' && e.isPrimary && e.button === 0) {
      startLongPress(e, frame, layer);
    }
    // The right button is the frame menu's: it must not collapse the block,
    // and while picking a press is a tap that spans it.
    if (picking || e.pointerType === 'touch' || !e.isPrimary || e.button !== 0 || e.shiftKey) {
      return;
    }
    // A selected cell is a handle, as in Krita: it carries its frames, and
    // with Ctrl it carries copies. A press elsewhere still spans a block, as
    // the reference does; Ctrl there toggles a layer on the click.
    const copy = e.ctrlKey || e.metaKey;
    if (isSelected(frame, layer)) {
      startCarry(e, frame, copy, true);
      return;
    }
    if (copy) {
      return;
    }
    lostCell.reset();
    dragging = true;
    // The anchor is the cell pressed: `selectCell` moves the active cell
    // there, and every later 'range' spans from it.
    editor.selectCell(frame, layer);
  }

  function onCellEnter(e: PointerEvent, frame: number, layer: number): void {
    if (!dragging || e.pointerType === 'touch') {
      return;
    }
    // A release outside the window (Alt+Tab mid-drag) sends no pointerup:
    // hovering after it stretched the block with no button held.
    if (lostCell(e, mainUp)) {
      dragging = false;
      return;
    }
    editor.selectCell(frame, layer, 'range');
    (e.currentTarget as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function endCellDrag(): void {
    dragging = false;
  }

  function onWindowUp(e: PointerEvent): void {
    onPinchUp(e);
    endCellDrag();
    endCarry(e);
    endMark(e);
  }

  /** The window lost: no release will come — the end mark goes back. */
  function onWindowBlur(): void {
    closeMenu();
    endMark(undefined, true);
  }

  function onWindowMove(e: PointerEvent): void {
    if (onPinchMove(e)) return;
    onCarryMove(e);
    onMarkMove(e);
  }

  /**
   * A press on the empty part of the strip collapses the block
   * (`bundle:8938-8944`). The rows stretch across the strip, so "empty" is
   * anywhere inside it that is not a cell — comparing the container against
   * itself would leave nowhere to press. A mouse convenience: a finger's press
   * there starts a scroll, and while picking it would undo the block.
   */
  function resetSelection(e: PointerEvent): void {
    if (editor.playing || picking || e.pointerType === 'touch' || (e.target as HTMLElement).closest('.cell, .bands')) {
      return;
    }
    // The strip's own scrollbar is where a block is carried to far frames.
    if (strip && e.target === strip && onScrollbar({ ...strip.getBoundingClientRect(), clientLeft: strip.clientLeft, clientTop: strip.clientTop, clientWidth: strip.clientWidth, clientHeight: strip.clientHeight }, e.clientX, e.clientY)) {
      return;
    }
    editor.collapseSelection();
  }

  /**
   * Home and End on a cell: the first and the last frame. J and L do it too,
   * but they are letter keys the settings can turn off (WCAG 2.1.4), and a
   * long strip is hundreds of arrows. Taken here, so the window's hotkeys
   * see a handled key.
   */
  function onStripKey(e: KeyboardEvent): void {
    if (picking && e.key === 'Escape') {
      e.preventDefault();
      picking = false;
      return;
    }
    if ((e.key !== 'Home' && e.key !== 'End') || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    e.preventDefault();
    editor.selectFrame(e.key === 'Home' ? 0 : frameTotal - 1);
  }

  // --- The frame menu -------------------------------------------------------
  // What the key row used to carry — delete, copy, paste, merge — lives on a
  // right press on the cell itself. The keys (A, Del, C, V, M) stay as they were.
  let menu = $state<{
    x: number;
    y: number;
    cell: HTMLElement;
    /** Where the strip stood when the menu was placed. */
    scroll: { left: number; top: number } | null;
    /** Opened on a frame's number: what it offers acts on the column, in every layer. */
    column: boolean;
  } | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>();

  /** A right press on a frame's number: the column's menu. */
  function openColumnMenu(e: MouseEvent, frame: number): void {
    e.preventDefault();
    if (menu) return;
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const keyed = e.button !== 2 || (!e.clientX && !e.clientY);
    showMenu(el, frame, editor.activeLayer, keyed ? { x: box.left, y: box.bottom, above: box.top } : { x: e.clientX, y: e.clientY, above: e.clientY }, false, true);
  }

  function openMenu(e: MouseEvent, frame: number, layer: number): void {
    e.preventDefault();
    // Android long-presses into a contextmenu too: the menu is already up.
    if (menu) {
      return;
    }
    const cell = e.currentTarget as HTMLElement;
    // The menu key and Shift+F10 fire with no pointer: open by the cell. Chrome
    // gives them the cell's middle for coordinates, a «mouse» pointer type and
    // button -1; only a real press is the right button.
    const box = cell.getBoundingClientRect();
    const keyed = e.button !== 2 || (!e.clientX && !e.clientY);
    showMenu(
      cell,
      frame,
      layer,
      keyed ? { x: box.left, y: box.bottom, above: box.top } : { x: e.clientX, y: e.clientY, above: e.clientY },
    );
  }

  // --- The frame menu under a finger ----------------------------------------
  // In «Toonop» delete, copy, paste and merge live only in this menu, and iOS
  // sends no contextmenu for a held finger — so a long press opens it. A move
  // is a scroll (the browser cancels the pointer), a lift is a tap.
  const LONG_PRESS_MS = 500;
  let longPress = 0;
  let longPressed = false;
  // A held finger when the strip goes (the layout steps down to the phone's)
  // would open a menu over a strip that is not there.
  $effect(() => cancelLongPress);

  function startLongPress(e: PointerEvent, frame: number, layer: number, cells = true): void {
    cancelLongPress();
    const cell = e.currentTarget as HTMLElement;
    const at = { x: e.clientX, y: e.clientY, above: e.clientY };
    const { pointerId, pointerType } = e;
    longPress = window.setTimeout(() => {
      longPress = 0;
      if (menu || editor.playing) return;
      longPressed = true;
      showMenu(cell, frame, layer, at, true, !cells);
      // Procreate Dreams' hold: the finger that opened the menu and moves on
      // without lifting picks the frame up instead.
      if (pointerType === 'touch') held = { pointerId, x: at.x, y: at.y, frame, startX: at.x, cells };
    }, LONG_PRESS_MS);
  }

  function cancelLongPress(): void {
    clearTimeout(longPress);
    longPress = 0;
  }

  // --- Carrying frames --------------------------------------------------------
  // A frame moves whole, in every layer, and a frame of the selected block
  // carries the block (owner, 2026-10-24). The mouse and the pen take it by
  // its number or by a selected cell; a finger holds a cell or a number, the
  // menu comes up, and a move without lifting puts the menu away and carries.
  // The strip reorders for real on every step, as a layer drag does: the
  // neighbours make way, and Escape takes everything back.
  /** How far a held finger travels before the hold becomes a carry, in px. */
  const CARRY_SLOP = 8;
  const CARRY_EDGE = 32;
  let held: { pointerId: number; x: number; y: number; frame: number; startX: number; cells: boolean } | null = null;
  let carry = $state<{
    pointerId: number;
    lastX: number;
    /** Where the block's first frame stood when the carry began, and stands now. */
    from: number;
    at: number;
    count: number;
    /** Which frame of the block the pointer took it by. */
    grab: number;
    /** Ctrl: the carry puts copies down, and whether it has put them yet. */
    copy: boolean;
    copied: boolean;
    /** Cells of the block's layers, not columns: the other layers stand (timeline-exposure-cells). */
    cells: boolean;
  } | null>(null);
  /** The click that ends a carry must not collapse the block it carried. */
  let carried = $state(false);
  const lostCarry = createLostRelease();
  let carryScroll = 0;
  let carryDirection: -1 | 0 | 1 = 0;

  function startCarry(e: { pointerId: number; clientX: number }, frame: number, copy = false, cells = false): void {
    if (editor.playing || carry || !strip) return;
    const { from, count } = framesToCarry(editor.selection, frame);
    lostCarry.reset();
    carry = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      from,
      at: from,
      count,
      grab: frame - from,
      copy,
      copied: false,
      cells,
    };
    carried = false;
    editor.beginGesture();
    // The studio's keys wait, as they do for a layer drag: Z mid-carry
    // changed the strip the carry counts in.
    editor.gestureHeld = true;
  }

  /** Mouse and pen: the number in the head picks its frame up. */
  function onNumDown(e: PointerEvent, frame: number): void {
    longPressed = false;
    carried = false;
    if (editor.playing || !e.isPrimary || e.button !== 0) return;
    if (e.pointerType === 'touch') {
      if (!editor.selection.frames.includes(frame)) editor.selectColumn(frame);
      startLongPress(e, frame, editor.activeLayer, false);
      return;
    }
    e.preventDefault();
    // Shift spans the frames from the active one, on the click.
    if (e.shiftKey) return;
    // The frame is taken in every layer, as the click will select it.
    if (!editor.selection.frames.includes(frame)) {
      editor.selectColumn(frame);
      if (editor.activeFrame !== frame) return; // refused: a transform under the lock
    }
    startCarry(e, frame, e.ctrlKey || e.metaKey);
  }

  /**
   * A click on a frame's number selects that frame in every layer, Shift the
   * frames from the active one (Aseprite, Krita). A carry or a finger's hold
   * that came before it has said what it had to.
   */
  function onNumClick(e: MouseEvent, frame: number): void {
    if (longPressed || carried) {
      longPressed = false;
      carried = false;
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    editor.selectColumn(frame, e.shiftKey);
  }

  function onCarryMove(e: PointerEvent): void {
    if (held && e.pointerId === held.pointerId && !carry) {
      if (Math.hypot(e.clientX - held.x, e.clientY - held.y) < CARRY_SLOP) return;
      const { frame, startX, cells } = held;
      held = null;
      closeMenu();
      startCarry({ pointerId: e.pointerId, clientX: startX }, frame, false, cells);
    }
    if (!carry || e.pointerId !== carry.pointerId) return;
    if (lostCarry(e, mainUp)) {
      endCarry(e);
      return;
    }
    carry.lastX = e.clientX;
    carryEdge(e.clientX);
    stepCarry();
  }

  /** The tick under the pointer: frames are as wide as they are held. */
  function pointedTick(clientX: number): number {
    if (!strip) return 0;
    const box = strip.getBoundingClientRect();
    const x = clientX - box.left - strip.clientLeft + strip.scrollLeft - GRID_GAP;
    return Math.floor(x / pitch);
  }

  /**
   * The block goes where the pointer is, held by the frame it was taken by.
   * Read off the strip as it now stands, not off the travel: a long frame
   * passed over takes as much of the hand as it takes of the strip.
   */
  function stepCarry(): void {
    if (!carry || !strip) return;
    if (carry.cells) {
      stepCellCarry();
      return;
    }
    const total = editor.cellBounds.frames;
    // Copies not yet put down will lengthen the strip: they may land past its end.
    const putting = carry.copy && !carry.copied;
    const holds = Array.from({ length: total }, (_, i) => timing.start(i + 1) - timing.start(i));
    const to = carryTarget(holds, carry.at, carry.count, carry.grab, pointedTick(carry.lastX), putting ? total : total - carry.count, putting);
    if (to === carry.at) return;
    if (carry.copy && to !== carry.from) {
      // Copies are put down afresh at every step: moved, a copy left copies of its own behind.
      const before = editor.cellBounds.frames - (carry.copied ? carry.count : 0);
      if (carry.copied) editor.withdrawFrames();
      editor.copyFramesTo(carry.from, carry.count, to);
      carry.copied = editor.cellBounds.frames === before + carry.count;
      if (!carry.copied) return; // refused: no room, or a transform
    } else if (carry.copy && to === carry.from) {
      // Back where it began: the copies right before their originals would be
      // a copy nobody aimed — it goes, as Krita drops a frame onto itself.
      editor.withdrawFrames();
      carry.copied = false;
      carry.at = carry.from;
      return;
    } else {
      // Laid again from where the drag began: each layer's drawing of the tick
      // goes exactly where it is let go (owner, 2026-11-17).
      if (editor.moveColumnsTo(carry.from, carry.count, to, true) === null) return; // refused: a transform
    }
    carry.at = to;
    carried = true;
    // A pen held still opened the menu before it moved: the frames go, the menu too.
    cancelLongPress();
    if (menu) closeMenu();
  }

  /** A carry of cells: the block goes where the pointer is, along its own layers only. */
  function stepCellCarry(): void {
    if (!carry) return;
    const want = Math.max(0, pointedTick(carry.lastX) - carry.grab);
    // Asked before the place is compared: a copy snapped onto the place it left stands there too.
    if (carry.copy && carry.copied && want === carry.from) {
      // Back where it began: no copy stays (Krita drops a frame onto itself).
      editor.withdrawGesture();
      carry.copied = false;
      carry.at = carry.from;
      return;
    }
    if (want === carry.at) return;
    // Laid again from where the drag began, every step: no step leaves anything behind.
    const landed = carry.copy
      ? editor.copyCellsInLayer(carry.from, carry.count, want, true)
      : editor.moveCellsInLayer(carry.from, carry.count, want, true);
    if (landed === null) return;
    // A copy put down is the carry's even where it lands on the place it left.
    carry.copied = carry.copy;
    if (landed === carry.at) return;
    carry.at = landed;
    carried = true;
    cancelLongPress();
    if (menu) closeMenu();
  }

  function carryEdge(clientX: number): void {
    if (!strip) return;
    const box = strip.getBoundingClientRect();
    const direction: -1 | 0 | 1 =
      clientX - box.left < CARRY_EDGE ? -1 : box.right - clientX < CARRY_EDGE ? 1 : 0;
    if (direction === carryDirection) return;
    stopCarryScroll();
    if (direction === 0) return;
    carryDirection = direction;
    carryScroll = window.setInterval(() => {
      strip?.scrollBy({ left: (direction * Math.max(pitch, 16)) / 2 });
      // The pointer may stand still at the edge: the place is counted here too.
      stepCarry();
    }, 80);
  }

  function stopCarryScroll(): void {
    clearInterval(carryScroll);
    carryScroll = 0;
    carryDirection = 0;
  }

  function endCarry(e?: PointerEvent): void {
    if (held && (!e || e.pointerId === held.pointerId)) held = null;
    if (!carry || (e && e.pointerId !== carry.pointerId)) return;
    stopCarryScroll();
    carry = null;
    editor.gestureHeld = false;
  }

  /** Escape: the frames go back where the carry found them. */
  function cancelCarry(): void {
    if (!carry) return;
    if (carry.copy) {
      if (carry.copied && carry.cells) editor.withdrawGesture();
      else if (carry.copied) editor.withdrawFrames();
    } else if (carry.cells) {
      // The drag's one step, taken back unfiled: everything as the carry found it.
      editor.withdrawGesture();
    } else {
      editor.withdrawGesture();
    }
    carried = false;
    endCarry();
  }

  function onCarryKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !(carry || mark)) return;
    e.preventDefault();
    e.stopPropagation();
    cancelCarry();
    endMark(undefined, true);
  }

  /** Whether cell `i` of the layer is the last of its drawing's time: its band ends there. */
  function endsDrawing(layer: number, i: number): boolean {
    const frames = editor.doc.layers[layer].frames;
    return i + 1 >= frames.length || frames[i + 1] !== null;
  }

  // --- The end of the film, by its mark ---------------------------------------
  // A mark after the last tick: dragged, the film is as long as where it is let
  // go. Longer continues every layer; shorter asks first when drawings go.
  let mark = $state<{ pointerId: number; startX: number; from: number; to: number } | null>(null);
  /** A release outside the window sends no pointerup: the next move with no button ends the drag. */
  const lostMark = createLostRelease();

  function onMarkDown(e: PointerEvent): void {
    if (editor.playing || !e.isPrimary || (e.pointerType !== 'touch' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    lostMark.reset();
    mark = { pointerId: e.pointerId, startX: e.clientX, from: frameTotal, to: frameTotal };
    editor.gestureHeld = true;
  }

  function onMarkMove(e: PointerEvent): void {
    if (!mark || e.pointerId !== mark.pointerId) return;
    // Let go outside the window: the length is not asked for by a hand that is gone.
    if (lostMark(e, mainUp)) {
      endMark(undefined, true);
      return;
    }
    mark.to = Math.max(1, mark.from + Math.round((e.clientX - mark.startX) / pitch));
  }

  function endMark(e?: PointerEvent, cancel = false): void {
    if (!mark || (e && e.pointerId !== mark.pointerId)) return;
    const to = mark.to;
    mark = null;
    editor.gestureHeld = false;
    if (!cancel) editor.setFilmLength(to);
  }

  /** Where the end mark stands: the film's end, or where the hand has it. */
  const markAt = (): number => (mark?.to ?? frameTotal) * pitch + GRID_GAP - gap / 2;

  // The finger that holds or carries must not scroll the strip under it. The
  // strip pans by touch, and only a cancelled touchmove stops a pan that the
  // browser has not begun yet — pointer events have no say in it.
  $effect(() => {
    const still = (e: TouchEvent) => {
      if (held || carry || pinch || mark) e.preventDefault();
    };
    document.addEventListener('touchmove', still, { passive: false });
    return () => {
      document.removeEventListener('touchmove', still);
      stopCarryScroll();
      if (carry) editor.gestureHeld = false;
    };
  });

  /** How far a finger-opened menu keeps from the fingertip, in px. */
  const FINGER_GAP = 16;

  function showMenu(
    cell: HTMLElement,
    frame: number,
    layer: number,
    at: { x: number; y: number; above: number },
    finger = false,
    column = false,
  ): void {
    if (editor.playing) {
      return;
    }
    // A press inside the block keeps it: the menu acts on what is selected.
    if (column) {
      if (!editor.selection.frames.includes(frame)) editor.selectColumn(frame);
    } else if (!isSelected(frame, layer)) {
      editor.selectCell(frame, layer);
    }
    menu = { x: at.x, y: at.y, cell, scroll: null, column };
    void tick().then(() => {
      if (!menu || !menuEl) return;
      // The strip sits at the bottom: a menu that would run off the screen opens up/left instead.
      menu.x = Math.max(4, Math.min(menu.x, innerWidth - menuEl.offsetWidth - 4));
      // Above the press rather than over the cell it acts on. Under a finger
      // it opens above the fingertip (below, if there is no room): opened
      // under it, the lift clicked the item it landed on.
      menu.y = frameMenuTop(at, menuEl.offsetHeight, innerHeight, finger ? FINGER_GAP : 0);
      menuEl.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
      if (strip) menu.scroll = { left: strip.scrollLeft, top: strip.scrollTop };
    });
  }

  /** `stay` leaves the strip where a scroll or a resize put it. */
  function closeMenu(refocus = false, stay = false): void {
    // The window of built frames may have taken the menu's cell away: the
    // strip's Tab stop takes focus instead of <body>.
    const cell = menu?.cell.isConnected ? menu.cell : strip?.querySelector<HTMLElement>('.cell[tabindex="0"]');
    if (refocus && menu) cell?.focus({ preventScroll: stay });
    menu = null;
  }

  /** The key an item names — none, the letter, or what still works with the letters off. */
  function menuKey(action: FrameMenuAction) {
    return editor.menuKey(action, editor.ux.quickPalette !== null);
  }

  function run(action: () => void): void {
    closeMenu(true);
    action();
  }

  function onMenuKey(e: KeyboardEvent): void {
    // The menu owns the keys while open: the arrows are not the studio's layer keys here.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    // A menu is one stop (WAI-ARIA menu pattern): Tab puts it away and hands
    // focus back to the cell, rather than walking out of a menu left open.
    if (e.key === 'Tab') {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (at + 1) % items.length
      : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
      : null;
    if (to === null) return;
    e.preventDefault();
    items[to]?.focus();
  }

  function onWindowDown(e: PointerEvent): void {
    // A tap on the sheet that put the menu away only closes it (dismiss-press.ts).
    if (menu && !menuEl?.contains(e.target as Node)) {
      closeMenu();
      notePopupClosed(e);
    }
  }

  // --- Soundtrack -----------------------------------------------------------
  // The reference's wave: half a bar per pixel of frame width, recomputed when
  // fps changes — the wave stretches over the strip rather than being re-read
  // from the file.
  const barsPerFrame = (cellWidth: number) => Math.max(1, Math.round(cellWidth / 2));
  // The canvas max-fitted into one frame — the same caps for every project.
  // `+2` is the 1px border on each side of the cell around the thumbnail; the
  // row it sits in grows with it, down to the floor its name and icons need.
  const cell = $derived(cellSize(editor.doc.width, editor.doc.height));
  const row = $derived(rowHeight(editor.doc));
  const thumbWidth = $derived(cell.w + 2);
  /**
   * The cell's width as zoomed (Ctrl+wheel, a pinch, the keys), the cell's
   * own until then; the gap between cells goes where they are too narrow for
   * it, so the bands of a long film run on unbroken.
   */
  const cellW = $derived(editor.settings.timelineZoom || thumbWidth);
  const gap = $derived(cellW >= 14 ? GRID_GAP : 0);
  const pitch = $derived(cellW + gap);
  /** What a cell shows at this width (strip-window.ts `stripLevel`). */
  const level = $derived(stripLevel(cellW));
  /** Which numbers the head writes: every one, or every fifth, tenth… */
  const every = $derived(numberEvery(pitch));
  /** Where each frame starts in ticks: a held frame is as wide as its ticks. */
  const timing = $derived(editor.timing);
  // Numbers, so the scroll-into-view effects hear the film change shape and
  // not every write — each one is a new document and a new timing.
  const filmTicks = $derived(timing.total);
  const layerTotal = $derived(editor.doc.layers.length);
  /** A frame's width on the strip: a cell a tick, and the gaps between them. */
  const spanWidth = (frame: number) => (timing.start(frame + 1) - timing.start(frame)) * pitch - gap;
  /** The frames built right now — the ones in view, plus a screen either side. */
  const view = $derived(stripWindow(frameTotal, cellW, gap, stripScroll, stripWidth, timing));
  // Numbers, so a scroll that keeps the window's edges rebuilds no list:
  // every scroll event made a new `view`, and every row diffed its cells.
  const firstBuilt = $derived(view.first);
  const countBuilt = $derived(view.count);
  const built = $derived(Array.from({ length: countBuilt }, (_, k) => firstBuilt + k));
  /** The frame of the strip's one Tab stop: the active cell, or the first in view when the scroll unbuilt it. */
  const tabFrame = $derived(stripTabStop(editor.displayedFrame, frameTotal, cellW, gap, stripScroll, stripWidth, timing));
  /**
   * The wave's bars, for the track, the rate and the cell's width. Read in the
   * markup it was a pass over the whole track on every stroke: a write
   * replaces the document, and `frame_rate` was read through it.
   */
  const fps = $derived(editor.doc.frame_rate);
  // A track this browser could not read has no length and no levels: a flat
  // lane would say «quiet here» about sound nobody has heard.
  const waveBars = $derived(editor.audio.hasTrack && editor.audio.duration > 0 ? editor.audio.bars(fps, barsPerFrame(cellW)) : null);
  /**
   * Every frame's width plus the row padding (a gap each end). The window
   * swaps cells for a wider spacer in steps, and a layout between them saw a
   * shorter row: the browser clamped the scroll to it, and a frame added at
   * the end sat cells past the right edge. The header holds the width, so the
   * scroll extent is arithmetic too.
   */
  const stripExtent = $derived(timing.total * pitch + GRID_GAP + END_ROOM);

  // --- Layer column width ---------------------------------------------------
  // The divider between the layer list and the grid. Until it is dragged the
  // column keeps its CSS width, so the phone layout stays narrow on its own.
  /** The floor is a row without its name: eye, tag, settings, handle, delete,
   *  the padding and the gaps — 145 px at 100 % text (`.layer-col` holds it in rem).
   *  To the pixel: one over showed a sliver of the name. */
  const COL_MIN = 145;
  const COL_MAX = 320;
  /** Keyboard step, in px (WCAG 2.2 AA 2.5.7 — no drag required). */
  const COL_STEP = 16;
  let colPx = $state(0);
  let colWidth = $state<number | null>(null);
  let colDrag: { pointerId: number; startX: number; startWidth: number } | null = null;
  const lostCol = createLostRelease();

  function setCol(px: number): void {
    colWidth = Math.min(COL_MAX, Math.max(COL_MIN, Math.round(px)));
  }

  function onColDown(e: PointerEvent): void {
    // The main button only: a right press is a context menu, not a drag.
    if (!e.isPrimary || e.button !== 0) return;
    lostCol.reset();
    colDrag = { pointerId: e.pointerId, startX: e.clientX, startWidth: colPx };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onColMove(e: PointerEvent): void {
    if (!colDrag || e.pointerId !== colDrag.pointerId) return;
    // A release outside the window sends no pointerup: hovering the band
    // after it went on resizing the column with no button held.
    if (lostCol(e, mainUp)) {
      colDrag = null;
      return;
    }
    setCol(colDrag.startWidth + e.clientX - colDrag.startX);
  }

  function onColUp(e: PointerEvent): void {
    if (colDrag && e.pointerId === colDrag.pointerId) colDrag = null;
  }

  function onColKey(e: KeyboardEvent): void {
    switch (e.key) {
      // From the width on screen: `max-width: 50%` may hold back the one asked
      // for, and ← stood still for press after press.
      case 'ArrowLeft':
        e.preventDefault();
        colWidth = stepColumn(colPx, -COL_STEP, COL_MIN, COL_MAX);
        break;
      case 'ArrowRight':
        e.preventDefault();
        colWidth = stepColumn(colPx, COL_STEP, COL_MIN, COL_MAX);
        break;
    }
  }


  /** Whether the head writes the number of tick `i`: thinned out, but the first and the one on screen always. */
  function named(i: number): boolean {
    return every === 1 || i === 0 || i === editor.displayedFrame || (i + 1) % every === 0;
  }
  /** Every how many seconds the ruler is marked: as often as its words have room. */
  const secondsEvery = $derived([1, 2, 5, 10, 30, 60, 300].find((k) => k * fps * pitch >= 36) ?? 600);

  /** What a cell is, read out: a drawing, an empty one, or the drawing a continuation shows. */
  function cellLabel(layer: number, i: number): string {
    const frames = editor.doc.layers[layer].frames;
    const own = frames[i];
    const base = own === null
      ? t('timeline.cell_continued', { frame: i + 1, key: keyOf(frames, i) + 1, layer: editor.layerLabel(layer) })
      : t(own.strokes.length ? 'timeline.cell' : 'timeline.cell_empty', { frame: i + 1, layer: editor.layerLabel(layer) });
    return `${base}${editor.isCopiedCell(i, layer) ? t('timeline.cell_copied') : ''}`;
  }

  /** The tick under a press on a row's canvas of bands. */
  function tickOf(e: MouseEvent): number {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.min(frameTotal - 1, Math.max(0, firstBuilt + Math.floor((e.clientX - box.left) / pitch)));
  }

  /** A drag over the bands spans the block, as over cells. */
  function onBandHover(e: PointerEvent, layer: number): void {
    if (!dragging || e.pointerType === 'touch') return;
    if (lostCell(e, mainUp)) {
      dragging = false;
      return;
    }
    editor.selectCell(tickOf(e), layer, 'range');
  }

  /**
   * What a cell is: a drawing, an empty one, or a continuation. Read through
   * the document each time: a stroke grows a cell in place, and a value held
   * from the same array would never hear it.
   */
  function kindOf(layer: number, i: number): 'drawing' | 'blank' | 'continued' {
    const own = editor.doc.layers[layer].frames[i];
    return own === null ? 'continued' : own.strokes.length > 0 ? 'drawing' : 'blank';
  }

  interface Bands {
    /** The document the frames are of: a new one is a reason to paint again. */
    doc: unknown;
    frames: readonly (Frame | null)[];
    first: number;
    count: number;
    pitch: number;
    height: number;
    now: number;
    selected: readonly number[];
  }

  /**
   * A row of bands on one canvas: each drawing a bar as long as it lasts, an
   * empty drawing hollow, the frame on screen a column of the accent. The
   * colours are the studio's own, read off the strip.
   */
  function drawBands(canvas: HTMLCanvasElement, bands: Bands) {
    const paint = (b: Bands) => {
      const ratio = devicePixelRatio || 1;
      const width = Math.max(1, Math.round(b.count * b.pitch));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(b.height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const look = getComputedStyle(canvas);
      const ink = look.getPropertyValue('--ink-2').trim() || '#555';
      const accent = look.getPropertyValue('--accent').trim() || '#d22';
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, b.height);
      const top = b.height * 0.25;
      const tall = b.height * 0.5;
      const picked = new Set(b.selected);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.14;
      for (const i of picked) {
        if (i >= b.first && i < b.first + b.count) ctx.fillRect((i - b.first) * b.pitch, 0, b.pitch, b.height);
      }
      ctx.globalAlpha = 1;
      const end = Math.min(b.frames.length, b.first + b.count);
      for (let i = b.first; i < end;) {
        const key = keyOf(b.frames as (Frame | null)[], i);
        let stop = i + 1;
        while (stop < end && b.frames[stop] === null) stop++;
        const x = (i - b.first) * b.pitch;
        const w = Math.max(1, (stop - i) * b.pitch - 1);
        const drawing = b.frames[key];
        if (drawing && drawing.strokes.length > 0) {
          ctx.fillStyle = ink;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(x, top, w, tall);
          ctx.globalAlpha = 1;
          // The drawing's own tick is darker: where it begins reads at a glance.
          if (b.frames[i] !== null) {
            ctx.fillRect(x, top, Math.min(w, Math.max(1, b.pitch - 1)), tall);
          }
        } else {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, top + 0.5, Math.max(0, w - 1), tall - 1);
        }
        i = stop;
      }
      if (b.now >= b.first && b.now < b.first + b.count) {
        ctx.fillStyle = accent;
        ctx.fillRect((b.now - b.first) * b.pitch, 0, Math.max(1, b.pitch), 2);
        ctx.fillRect((b.now - b.first) * b.pitch, b.height - 2, Math.max(1, b.pitch), 2);
      }
    };
    paint(bands);
    return { update: paint };
  }
</script>

{#snippet wave(cellWidth: number)}
  {#if waveBars}
    {@const per = barsPerFrame(cellWidth)}
    {@const bars = waveBars}
    <!-- Decoration: the note key's panel carries the track's name, its length
         and the controls. The lane is drawn even where the track is silent, so
         an empty stretch reads as "quiet here", not as a missing waveform. -->
    <div class="wave" aria-hidden="true" style:min-width={`${stripExtent}px`}>
      {#if view.before > 0}
        <span class="gap" style:width="{view.before}px"></span>
      {/if}
      {#each built as i (i)}
        {@const from = timing.start(i) * per}
        <span class="bar" style:width="{spanWidth(i)}px">
          {#each { length: (timing.start(i + 1) - timing.start(i)) * per } as _, k (k)}
            <span style:height="{Math.max(6, Math.round((bars[from + k] ?? 0) * 100))}%"></span>
          {/each}
        </span>
      {/each}
      {#if view.after > 0}
        <span class="gap" style:width="{view.after}px"></span>
      {/if}
    </div>
  {/if}
{/snippet}


<!-- The release may land anywhere — outside the grid, outside the window —
     so the drag always ends on the window rather than on a cell. -->
<svelte:window onpointerup={onWindowUp} onpointercancel={onWindowUp} onpointermove={onWindowMove} onkeydowncapture={onCarryKey} onpointerdown={onWindowDown} onblur={onWindowBlur} onresize={() => closeMenu(true, true)} />

<!-- The bottom panel owns the height; the timeline fills the row it is given. -->
<div class="board">
  <!-- Read out whenever the block is wider than one cell; shown as a bar,
       with the way out, only while picking. -->
  <!-- A block wider than one cell says what it is and what can be done to
       it (Procreate Dreams, FlipaClip): the frame menu's actions, in reach. -->
  <div class="pick-bar" class:shown={picking || (spanned && !editor.playing)} style:--col="{colPx}px">
    <p role="status" aria-live="polite">{spanned || picking ? spanText : ''}</p>
    {#if picking}
      <span class="pick-hint">{t('timeline.pick_hint')}</span>
    {/if}
    {#if spanned && !editor.playing}
      <button class="key icon" title={duplicateTitle} aria-label={duplicateTitle} disabled={!editor.canDuplicateFrames} onclick={() => editor.duplicateActiveFrame()}>
        <Icon name="duplicate" size={16} />
      </button>
      <button class="key icon" title={t('panel.item.copy')} aria-label={t('panel.item.copy')} onclick={() => editor.copySelection()}>
        <Icon name="copy" size={16} />
      </button>
      <button class="key icon" title={t('panel.item.paste')} aria-label={t('panel.item.paste')} disabled={!editor.canPasteCells} onclick={() => editor.pasteSelection()}>
        <Icon name="paste" size={16} />
      </button>
      <button class="key icon" title={t('panel.item.delete_frames', span)} aria-label={t('panel.item.delete_frames', span)} disabled={!editor.canRemoveFrame} onclick={() => editor.removeActiveFrame()}>
        <Icon name="trash" size={16} />
      </button>
    {/if}
    {#if picking}
      <button class="key primary" onclick={endPicking}>{t('timeline.pick_done')}</button>
    {:else if spanned && !editor.playing}
      <button class="key icon" title={t('timeline.clear_selection')} aria-label={t('timeline.clear_selection')} onclick={() => editor.collapseSelection()}>
        <Icon name="x" size={16} />
      </button>
    {/if}
  </div>
  <!-- The names and the cells are two scrollers side by side; a scroll in one
       is a scroll in the other, or the rows stop meaning the same layer.
       Scroll does not bubble, so this listens in the capture phase. -->
  <div class="body" bind:this={body} onscrollcapture={syncRowScroll} onwheel={wheelAlong}>
    <div
      class="layer-col"
      class:single={editor.doc.layers.length === 1}
      bind:clientWidth={colPx}
      style:width={colWidth === null ? undefined : `${colWidth}px`}
    >
      <LayerRows {editor} />
    </div>

    <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
         svelte-check's non-interactive rules do not model. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="col-resizer"
      role="separator"
      aria-label={t('timeline.col_width')}
      aria-orientation="vertical"
      aria-valuenow={colPx}
      aria-valuemin={Math.min(COL_MIN, colPx)}
      aria-valuemax={Math.max(COL_MAX, colPx)}
      tabindex="0"
      onpointerdown={onColDown}
      onpointermove={onColMove}
      onpointerup={onColUp}
      onpointercancel={onColUp}
      onkeydown={onColKey}
      title={t('timeline.col_width_title')}
    ></div>

    <!-- The press-to-deselect is a mouse convenience on top of the cells,
         which are ordinary buttons: nothing here is keyboard-only reachable
         through the container, so it stays a labelled group. -->
    <div
      class="grid"
      class:carrying={carry !== null}
      class:copying={carry?.copy === true}
      role="group"
      aria-label={t('timeline.grid')}
      bind:this={strip}
      bind:clientWidth={stripWidth}
      style:--gap="{gap}px"
      onpointerdowncapture={onPinchDown}
      onpointerdown={resetSelection}
      onfocusin={(e) => (lastCell = (e.target as HTMLElement).closest('.cell'))}
      onanimationend={() => (arrived = null)}
    >
      <div class="head" style:min-width={`${stripExtent}px`} style:--pitch="{cellW}px">
        {#if view.before > 0}
          <span class="gap" style:width="{view.before}px" aria-hidden="true"></span>
        {/if}
        {#each built as i (i)}
          <!-- A handle for the pointer only: the keyboard moves frames by
               «Сдвинуть» in the frame menu, and the column's menu opens on a
               right press or a held finger. -->
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
          <span
            class="num"
            class:lifted={carried && carry !== null && !carry.cells && i >= carry.at && i < carry.at + carry.count}
            data-col={i}
            style:width="{spanWidth(i)}px"
            class:onion={onionFrames.includes(i)}
            class:copied={editor.isCopiedFrame(i)}
            class:now={i === editor.displayedFrame}
            class:picked={editor.selection.frames.includes(i)}
            onpointerdown={(e) => onNumDown(e, i)}
            onclick={(e) => onNumClick(e, i)}
            oncontextmenu={(e) => openColumnMenu(e, i)}
            onpointerup={cancelLongPress}
            onpointercancel={cancelLongPress}
            onpointerleave={cancelLongPress}
            title={onionFrames.includes(i) ? t('timeline.frame_onion', { n: i + 1 }) : t('timeline.frame', { n: i + 1 })}
          >{#if (i + 1) % (fps * secondsEvery) === 0}<span class="sec" aria-hidden="true">{t('timeline.seconds', { n: (i + 1) / fps })}</span>{/if}{#if named(i)}{i + 1}{/if}</span>
        {/each}
        {#if view.after > 0}
          <span class="gap" style:width="{view.after}px" aria-hidden="true"></span>
        {/if}
        <!-- The frame cursor (owner, 2026-11-17): a line on the left edge of the
             tick on screen, down through every layer, as a playhead runs in an
             editor of time. It follows the preview; it takes no press. -->
        <span class="playhead" aria-hidden="true" style:left="{GRID_GAP + editor.displayedFrame * pitch - gap / 2}px"></span>
        <!-- The film's end: dragged, the film is as long as where it is let
             go. «Кадров» over the layers is the same with the keyboard. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="end-mark"
          class:dragging={mark !== null}
          style:left="{markAt()}px"
          title={t('timeline.end_mark', { n: mark?.to ?? frameTotal })}
          onpointerdown={onMarkDown}
        ></span>
      </div>
      {#each rows as layerIndex (editor.doc.layers[layerIndex])}
        <div class="cells" style:height={rowHeightCss(editor.doc)} class:current={layerIndex === editor.activeLayer} class:arrived={arrived?.layer === editor.doc.layers[layerIndex]}>
          {#if view.before > 0}
            <span class="gap" style:width="{view.before}px" aria-hidden="true"></span>
          {/if}
          {#if level === 'bands'}
            <!-- A long film at a glance: each drawing a band as long as it
                 lasts, the whole row one canvas — a button a tick was
                 thousands of them. The active cell keeps a button of its own,
                 the strip's Tab stop. -->
            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
            <canvas
              class="bands"
              class:dim={editor.doc.layers[layerIndex].hidden}
              style:width="{countBuilt * pitch}px"
              style:height="{cell.h + 2}px"
              use:drawBands={{ frames: editor.doc.layers[layerIndex].frames, doc: editor.doc, first: firstBuilt, count: countBuilt, pitch, height: cell.h + 2, now: editor.displayedFrame, selected: editor.selection.layers.includes(layerIndex) ? editor.selection.frames : [] }}
              onpointerdown={(e) => onCellDown(e, tickOf(e), layerIndex)}
              onpointermove={(e) => onBandHover(e, layerIndex)}
              onclick={(e) => onCellClick(e, tickOf(e), layerIndex)}
              oncontextmenu={(e) => openMenu(e, tickOf(e), layerIndex)}
              onpointerup={cancelLongPress}
              onpointercancel={cancelLongPress}
              onpointerleave={cancelLongPress}
            ></canvas>
            {#if layerIndex === editor.activeLayer && tabFrame >= firstBuilt && tabFrame < firstBuilt + countBuilt}
              <!-- The strip's one Tab stop: the active cell, or the first in view when the scroll left it behind. -->
              <button
                class="cell band-cell"
                class:active={tabFrame === editor.displayedFrame}
                class:now={tabFrame === editor.displayedFrame}
                style:left="{GRID_GAP + tabFrame * pitch}px"
                style:width="{Math.max(cellW, 4)}px"
                style:height="{cell.h + 2}px"
                data-frame={tabFrame}
                tabindex="0"
                aria-current={tabFrame === editor.displayedFrame ? 'true' : undefined}
                aria-disabled={editor.playing}
                onkeydown={onStripKey}
                onpointerdown={(e) => onCellDown(e, tabFrame, layerIndex)}
                onpointerup={cancelLongPress}
                onpointercancel={cancelLongPress}
                onpointerleave={cancelLongPress}
                onclick={(e) => onCellClick(e, tabFrame, layerIndex)}
                oncontextmenu={(e) => openMenu(e, tabFrame, layerIndex)}
                aria-label={cellLabel(layerIndex, tabFrame)}
              ></button>
            {/if}
          {:else}
          {#each built as i (i)}
            {@const kind = kindOf(layerIndex, i)}
            <button
              class="cell"
              style:width="{spanWidth(i)}px"
              style:height="{cell.h + 2}px"
              class:active={i === editor.displayedFrame && layerIndex === editor.activeLayer}
              class:now={i === editor.displayedFrame}
              class:continued={kind === 'continued'}
              class:blank={kind === 'blank'}
              class:held={kind !== 'continued' && !endsDrawing(layerIndex, i)}
              class:closes={kind === 'continued' && endsDrawing(layerIndex, i)}
              class:marks={level === 'marks'}
              class:selected={isSelected(i, layerIndex)}
              class:copied={editor.isCopiedCell(i, layerIndex)}
              class:dim={editor.doc.layers[layerIndex].hidden}
              class:arrived={arrived?.frames?.has(columnKey(i) as Frame) ?? false}
              class:lifted={carried && carry !== null && i >= carry.at && i < carry.at + carry.count
                && (!carry.cells || editor.selection.layers.includes(layerIndex))}
              data-frame={i}
              tabindex={i === tabFrame && layerIndex === editor.activeLayer ? 0 : -1}
              aria-disabled={editor.playing}
              aria-current={i === editor.displayedFrame && layerIndex === editor.activeLayer
                ? 'true'
                : undefined}
              aria-pressed={isSelected(i, layerIndex)}
              onclick={(e) => onCellClick(e, i, layerIndex)}
              onpointerdown={(e) => onCellDown(e, i, layerIndex)}
              onpointerenter={(e) => onCellEnter(e, i, layerIndex)}
              onkeydown={onStripKey}
              onpointerup={cancelLongPress}
              onpointercancel={cancelLongPress}
              onpointerleave={cancelLongPress}
              oncontextmenu={(e) => openMenu(e, i, layerIndex)}
              title={t('timeline.cell', { frame: i + 1, layer: editor.layerLabel(layerIndex) })}
              aria-label={cellLabel(layerIndex, i)}
            >
              {#if kind === 'drawing'}
                {#if level === 'thumbs'}
                  <LayerThumb
                    doc={editor.doc}
                    {layerIndex}
                    frameIndex={i}
                    maxW={Math.min(CELL_BOX.w, cellW - 2)}
                    maxH={CELL_BOX.h}
                  />
                {:else}
                  <span class="dot" aria-hidden="true"></span>
                {/if}
              {:else if kind === 'blank'}
                <span class="ring" aria-hidden="true"></span>
              {/if}
            </button>
          {/each}
          {/if}
          {#if view.after > 0}
            <span class="gap" style:width="{view.after}px" aria-hidden="true"></span>
          {/if}
        </div>
      {/each}
      {@render wave(cellW)}
    </div>
  </div>
</div>

{#if menu}
  <div
    class="frame-menu"
    role="menu"
    tabindex="-1"
    aria-label={t('timeline.menu')}
    style:left="{menu.x}px"
    style:top="{menu.y}px"
    bind:this={menuEl}
    onkeydown={onMenuKey}
  >
    {#snippet key(action: FrameMenuAction)}
      {@const k = menuKey(action)}
      {#if k}<kbd aria-hidden="true">{k.label}</kbd>{/if}
    {/snippet}
    {#if menu.column}
      <!-- The frame's number: the column, in every layer. -->
      <button role="menuitem" disabled={!editor.canShiftFrames(-1)} onclick={() => run(() => editor.shiftFrames(-1))}>
        <Icon name="chevron-left" size={16} /><span>{t('panel.item.shift_column_left')}</span>
      </button>
      <button role="menuitem" disabled={!editor.canShiftFrames(1)} onclick={() => run(() => editor.shiftFrames(1))}>
        <Icon name="chevron-right" size={16} /><span>{t('panel.item.shift_column_right')}</span>
      </button>
      <button role="menuitem" disabled={!editor.canRemoveColumn} onclick={() => run(() => editor.removeColumns())}>
        <Icon name="trash" size={16} /><span>{span.from === span.to ? t('panel.item.delete_column') : t('panel.item.delete_columns', span)}</span>
      </button>
    {:else}
    <button role="menuitem" aria-keyshortcuts={menuKey('add')?.aria} disabled={!editor.canAddFrame} onclick={() => run(() => editor.addFrameAfterActive())}>
      <Icon name="plus" size={16} /><span>{t('panel.item.add_frame')}</span>{@render key('add')}
    </button>
    <button role="menuitem" aria-keyshortcuts={menuKey('duplicate')?.aria} disabled={!editor.canDuplicateFrames} onclick={() => run(() => editor.duplicateActiveFrame())}>
      <Icon name="duplicate" size={16} /><span>{span.from === span.to ? t('panel.item.duplicate_frame') : t('panel.item.duplicate_frames', span)}</span>{@render key('duplicate')}
    </button>
    <button role="menuitem" disabled={!editor.canShiftCells(-1)} onclick={() => run(() => editor.shiftCells(-1))}>
      <Icon name="chevron-left" size={16} /><span>{t('panel.item.shift_left')}</span>
    </button>
    <button role="menuitem" disabled={!editor.canShiftCells(1)} onclick={() => run(() => editor.shiftCells(1))}>
      <Icon name="chevron-right" size={16} /><span>{t('panel.item.shift_right')}</span>
    </button>
    <button role="menuitem" aria-keyshortcuts={menuKey('delete')?.aria} disabled={!editor.canRemoveFrame} onclick={() => run(() => editor.removeActiveFrame())}>
      <Icon name="trash" size={16} /><span>{span.from === span.to ? t('panel.item.delete_frame') : t('panel.item.delete_frames', span)}</span>{@render key('delete')}
    </button>
    <button role="menuitem" aria-keyshortcuts={menuKey('copy')?.aria} onclick={() => run(() => editor.copySelection())}>
      <Icon name="copy" size={16} /><span>{t('panel.item.copy')}</span>{@render key('copy')}
    </button>
    <button role="menuitem" aria-keyshortcuts={menuKey('paste')?.aria} disabled={!editor.canPasteCells} onclick={() => run(() => editor.pasteSelection())}>
      <Icon name="paste" size={16} /><span>{t('panel.item.paste')}</span>{@render key('paste')}
    </button>
    <button role="menuitem" aria-keyshortcuts={menuKey('merge')?.aria} disabled={!editor.canPasteCells} onclick={() => run(() => editor.mergeSelection())}>
      <Icon name="merge" size={16} /><span>{t('panel.item.merge')}</span>{@render key('merge')}
    </button>
    <button role="menuitemcheckbox" aria-checked={picking} onclick={() => run(() => (picking = !picking))}>
      <Icon name="expand" size={16} /><span>{t('timeline.pick')}</span>
    </button>
    {/if}
  </div>
{/if}

<style>

  /* --- The layer × frame grid -------------------------------------------- */
  .board {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    border: none;
    border-radius: var(--r-sm);
    background: var(--canvas);
    overflow: hidden;
  }
  .layer-col {
    display: flex;
    flex-direction: column;
    flex: none;
    /* The row spends 137 of this on furniture — padding, eye, tag, handle,
       delete and four gaps — so 11rem left 39 for the name and «Слой 1» needs
       45. The editor's own default name did not fit the editor's own default
       column; the divider is for long names, not for that. */
    /* Never narrower than the row's keys (LayerRows): eye, settings, handle
       and bin at 1rem + 8px, the tag's 16, the padding's 13 and five 4 px
       gaps. The name gives way down to nothing; the keys do not leave it. */
    min-width: calc(4rem + 81px);
    /* 10rem at 200 % text on a 320 px phone is the whole strip: not one
       cell was left to press. The names give way before the frames do. */
    max-width: 50%;
    /* 165 of furniture with the settings key, and «Слой 1» needs 45. */
    width: 14rem;
    min-height: 0;
  }
  /* The splitter's own 24 px between the names and the grid (WCAG 2.2 2.5.8).
     Drawn 7 px wide with an invisible 24 px band over its neighbours, it
     reached ~6 px into frame 1 and ~3 px into the layer's bin — whole rows and
     cells are presses of their own — and a press at a cell's edge resized the
     column (owner, fifteenth audit). Now no press on either side is its. */
  .col-resizer {
    position: relative;
    flex: none;
    width: 24px;
    cursor: ew-resize;
    touch-action: none;
  }
  /* The hairline the column used to draw, at the names' edge: in the band's
     middle it left 12 px of white between a row's fill and the line. */
  .col-resizer::after {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--hairline);
  }
  .col-resizer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .grid {
    flex: 1;
    min-width: 0;
    overflow: auto;
    /* Two fingers zoom the strip (a pinch), not the page under the studio. */
    touch-action: pan-x pan-y;
  }
  .head {
    box-sizing: border-box;
    display: flex;
    align-items: flex-end;
    gap: var(--gap, 2px);
    /* As tall as the layer list's head beside it (LayerRows): the seconds'
       ruler over the numbers, which keep their 2rem. */
    height: 2.75rem;
    padding: 0 2px;
    border-bottom: 1px solid var(--hairline);
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--canvas);
  }
  /* Four digits never outgrow the cell: at 200 % text «1485» was 54 px over
     48, and a portrait board's 28 px cell overflowed at 100 % — the header
     read «14851486…». 0.42 of the pitch is four digits and a hair of air. */
  .num {
    flex: none;
    box-sizing: border-box;
    height: 2rem;
    text-align: center;
    /* Thinned to every fifth or tenth number when the cells are narrow, so
       a number takes the room of four digits whatever the cell's width. */
    font-size: min(0.74rem, max(0.7rem, calc(var(--pitch) * 0.42)));
    line-height: 2rem;
    white-space: nowrap;
    overflow: visible;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
    /* The number is the frame's handle: it is taken, not selected as text. */
    cursor: grab;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  /* The cross of the frame on screen (Animate, Krita, Aseprite): its number
     a red plate in the head, a band down its column through every layer,
     and the active layer's row washed as its name is. The selected frames
     are named in the head too, so a block reads from above as from inside. */
  /* Pills inside the head's 2rem, not blocks filling it: the padding keeps
     the plate off the edges and the cell's width stays the column's pitch. */
  .num:is(.picked, .now) {
    box-sizing: border-box;
    padding: 0.3rem 3px;
    line-height: 1.4rem;
    border-radius: var(--r-pill);
    font-weight: 700;
  }
  .num.picked {
    background: var(--accent-wash) content-box;
    background: color-mix(in srgb, var(--accent) 14%, transparent) content-box;
    color: var(--accent-ink);
  }
  /* A frame joining the selection takes its tone in; the frame on screen
     jumps (the Answering-Motion Rule), so `.now` carries no transition. */
  .num.picked:not(.now) {
    transition: background-color var(--dur) var(--ease-out);
  }
  .num.now {
    background: var(--accent) content-box;
    color: var(--canvas);
    text-decoration: none;
  }
  .cells.current {
    background: var(--accent-tint);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
  /* The band is a ring round each cell of the column, wide as the gaps, so
     the cells of one frame join into a column without a box drawn over the
     strip — which scrolls, and builds only the frames in view. */
  .cell.now {
    box-shadow: 0 0 0 2px var(--accent-wash);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .cell.now.active {
    box-shadow: inset 0 0 0 2px var(--accent), 0 0 0 2px var(--accent-wash);
    box-shadow: inset 0 0 0 2px var(--accent), 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .num {
    position: relative;
  }
  /* The carried block is picked up, as in Procreate Dreams: a touch larger
     and over the strip, with the shadow of what is lifted off it. It settles
     back when let go. Only the scale moves — a cell has no other transition,
     so nothing of it smears under a preview. */
  .cell,
  .num {
    transition: scale var(--dur-fast) var(--ease-out);
  }
  .cell.lifted {
    position: relative;
    z-index: 2;
    scale: 1.06;
    box-shadow: var(--shadow-lift);
  }
  /* Over the column's band and the active ring alike: the lift is the one
     shadow a cell casts, and the active ring stays inside it. */
  .cell.lifted.now {
    box-shadow: var(--shadow-lift);
  }
  .cell.lifted.active,
  .cell.lifted.now.active {
    box-shadow: inset 0 0 0 2px var(--accent), var(--shadow-lift);
  }
  .num.lifted {
    scale: 1.08;
  }
  .grid.carrying,
  .grid.carrying :is(.num, .cell) {
    cursor: grabbing;
  }
  .grid.copying,
  .grid.copying :is(.num, .cell) {
    cursor: copy;
  }
  /* Onion and copied frames are named in the header, not only tinted. */
  .num.onion {
    color: var(--onion-ink);
    text-decoration: underline dotted;
  }
  .num.copied::after {
    content: '⧉';
    margin-left: 1px;
  }
  .cells {
    position: relative;
    display: flex;
    gap: var(--gap, 2px);
    padding: 2px;
    align-items: center;
  }
  /* --- The seconds' ruler ------------------------------------------------ */
  /* A tick at the end of every whole second, its word above the numbers. */
  .sec {
    position: absolute;
    right: 0;
    bottom: 100%;
    padding-right: 2px;
    border-right: 1px solid var(--ink-2);
    font-size: 0.7rem;
    line-height: 0.75rem;
    font-weight: 400;
    color: var(--ink-2);
    white-space: nowrap;
    pointer-events: none;
  }
  /* --- The frame cursor -------------------------------------------------- */
  /* No transition: it jumps with the frame, as the ring of the frame on
     screen does — eased, it smeared across the strip under a preview. */
  .playhead {
    position: absolute;
    top: 0;
    width: 0;
    height: 2.75rem;
    pointer-events: none;
    z-index: 3;
  }
  /* The line, through the rows below the head. */
  .playhead::after {
    content: '';
    position: absolute;
    left: -1px;
    top: 0;
    width: 2px;
    height: 100vh;
    background: var(--accent);
  }
  /* Its tab in the ruler: a point down onto the line. */
  .playhead::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 0;
    width: 10px;
    height: 8px;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    background: var(--accent);
  }
  /* --- The film's end ---------------------------------------------------- */
  /* Not a line — a line is the cursor's (owner, 2026-11-17: the end read as
     the cursor). Past the end the strip is hatched: there is no film there.
     The handle is a bracket in the head that closes the frames. */
  .end-mark {
    position: absolute;
    bottom: 0;
    width: 14px;
    height: 2rem;
    cursor: ew-resize;
    touch-action: none;
    z-index: 2;
  }
  /* The hatching past the end, down through the rows. */
  .end-mark::after {
    content: '';
    position: absolute;
    left: 0;
    top: 100%;
    width: 48px;
    height: 100vh;
    background: repeating-linear-gradient(135deg, var(--hairline) 0 2px, transparent 2px 7px);
    pointer-events: none;
  }
  /* The bracket: ] closing the frames' numbers. */
  .end-mark::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.3rem;
    bottom: 0.3rem;
    width: 6px;
    box-sizing: border-box;
    border: 2px solid var(--ink-2);
    border-left: none;
    border-radius: 0 3px 3px 0;
  }
  .end-mark.dragging::before {
    border-color: var(--accent);
  }
  @media (hover: hover) {
    .end-mark:hover::before {
      border-color: var(--accent);
    }
  }

  .cell {
    flex: none;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--canvas);
    cursor: pointer;
    /* A held finger opens the frame menu, not the system callout or a loupe. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  /* The drawing fades, not the button: faded whole, the active ring and the
     focus ring on a hidden layer were red at 35 % — 1.6:1 on white. */
  /* A continuation shows the drawing it continues, faded, under a dashed
     line along its top: told apart from a drawing without its colour. */
  /* Three kinds, told apart without colour (WCAG 1.4.1): a drawing is its
     thumbnail (a dot when the cells are narrow), an empty drawing a hollow
     ring, a continuation no box at all — only the band of its drawing's time,
     running on from the drawing across the gaps. */
  .cell {
    position: relative;
  }
  .cell.continued {
    overflow: visible;
    border-color: transparent;
    background: transparent;
  }
  .cell.continued::before,
  .cell.held::before {
    content: '';
    position: absolute;
    top: 50%;
    height: 6px;
    translate: 0 -50%;
    background: var(--ink-2);
    opacity: 0.4;
    pointer-events: none;
  }
  /* From the drawing's middle to its edge, under its lines. */
  .cell.held::before {
    left: 50%;
    right: -1px;
  }
  .cell.continued::before {
    left: calc(-1px - var(--gap, 2px));
    right: -1px;
  }
  .cell.continued.closes::before {
    right: 25%;
    border-radius: 0 3px 3px 0;
  }
  .ring,
  .dot {
    position: relative;
    box-sizing: border-box;
    width: min(12px, calc(100% - 4px));
    aspect-ratio: 1;
    border-radius: 50%;
    pointer-events: none;
  }
  .ring {
    border: 2px solid var(--ink-2);
    background: var(--canvas);
  }
  .dot {
    width: min(10px, calc(100% - 4px));
    background: var(--ink);
  }
  /* --- A long film as bands ---------------------------------------------- */
  .bands {
    flex: none;
    display: block;
    /* The site's sheet caps every canvas at its box (app.css): a row of bands is wider by design. */
    max-width: none;
    cursor: pointer;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .bands.dim {
    opacity: 0.35;
  }
  /* The active cell over its band: the strip's Tab stop, a ring and no fill. */
  .band-cell {
    position: absolute;
    top: 2px;
    min-width: 4px;
    background: transparent;
  }
  .cell.dim > :global(canvas) {
    opacity: 0.35;
  }
  /* Active is a solid ring, the selection a dashed one, the copied block a
     dotted one — three shapes, so colour is never the only signal. */
  .cell.selected {
    border-style: dashed;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .cell.copied {
    border-style: dotted;
  }
  .cell.active {
    border-style: solid;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .cell[aria-disabled='true'] {
    cursor: default;
  }
  /* No transition on a cell: the ring of the frame on screen jumps, at a
     click as under a preview — eased, it smeared across the strip at 24
     frames a second. What moves is the one frame or layer that has just
     come (`arrived`), once, so the eye finds where it landed. A layer comes
     as a row, in one piece: its cells one by one were a strip of them. */
  .cell.arrived {
    animation: cell-in var(--dur-enter) var(--ease-out);
  }
  .cells.arrived {
    animation: fade-in var(--dur-enter) var(--ease-out);
  }
  /* Forced colours drop the active cell's inset ring (a shadow) and repaint
     every border alike: the active cell takes a thick Highlight border, the
     selection keeps its dashes in Highlight, and the onion numbers, whose
     blue is gone, keep a heavier dotted underline. */
  @media (forced-colors: active) {
    .cell.active {
      border: 3px solid Highlight;
    }
    .cell.selected {
      border-color: Highlight;
    }
    .num.onion {
      text-decoration-thickness: 2px;
    }
    .playhead::after,
    .playhead::before {
      background: Highlight;
      forced-color-adjust: none;
    }
    /* Told from the numbers under it by its shadow alone. */
    .pick-bar.shown {
      outline: 1px solid CanvasText;
    }
    /* The splitter's line is a background, which this mode paints as Canvas. */
    .col-resizer::after {
      background: CanvasText;
      forced-color-adjust: none;
    }
  }
  /* --- Picking bar ------------------------------------------------------- */
  /* Out of sight but read out when not picking; a row over the strip when it is. */
  .pick-bar:not(.shown) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* A chip over the frame numbers rather than a row: the panel is often only
     a row of cells tall, and a row taken from it hid the cells being picked.
     Not above the strip either — there it hid the transport keys (WCAG
     2.4.11), and what lies above is whatever the panels were arranged into.
     Its own header's height, so the cells stay clear, and short of the layer
     column. A drop, so it takes the menu shadow. */
  .pick-bar.shown {
    /* The Dense-Timeline Rule: a key in the strip is 24 px and up. */
    --key-h: 28px;
    position: absolute;
    right: 0;
    top: 0;
    z-index: var(--z-menu);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100% - var(--col, 0px) - 8px);
    box-sizing: border-box;
    padding: 2px 2px 2px 12px;
    border-radius: var(--r-pill);
    background: var(--paper);
    box-shadow: var(--shadow-menu);
    /* Up from the cells it names, as a menu comes from its key. */
    --pop-from: 4px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  .pick-bar p {
    margin: 0;
    white-space: nowrap;
    font-weight: 700;
    color: var(--accent-ink);
  }
  .pick-hint {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.8rem;
    color: var(--ink-2);
  }
  /* --- The frame menu ---------------------------------------------------- */
  /* A drop, so it takes the menu shadow (DESIGN: only what falls over work). */
  .frame-menu {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    /* 13rem at 200 % text is 416 px, past a 320 px phone's edge; min-width
       beats max-width, so the cap sits in it too. Fixed, so 100 % is the
       window without its scrollbar. */
    min-width: min(13rem, calc(100% - 8px));
    max-width: calc(100% - 8px);
    /* Six 44 px items outgrow a 200 px window (1280×800 at 400 %): the last
       two sat under the edge. The menu scrolls inside the screen instead. */
    max-height: calc(100dvh - 8px);
    overflow-y: auto;
    padding: 4px;
    border-radius: var(--r-md);
    background: var(--canvas);
    box-shadow: var(--shadow-menu);
    /* Up into place: it opens over the press. Only the look — the items take
       the press and the focus from the first frame. */
    --pop-from: 4px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  .frame-menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--key-h, 2.75rem);
    padding: 0 10px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .frame-menu span {
    flex: 1;
  }
  .frame-menu kbd {
    font: inherit;
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  /* A menu opened by a held finger named «A / Del / C / V / M»: keys a phone
     does not have. Where no pointer is fine there is no keyboard to press. */
  @media not all and (any-pointer: fine) {
    .frame-menu kbd {
      display: none;
    }
  }
  .frame-menu button:focus-visible {
    background: var(--hairline-soft);
  }
  @media (hover: hover) {
    .frame-menu button:hover:not(:disabled) {
      background: var(--hairline-soft);
    }
  }
  /* The tint alone is 1.1:1 — the arrows need the studio's ring, laid inside
     the item so the menu's own edge does not clip it. */
  .frame-menu button:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .frame-menu button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* --- Soundtrack --------------------------------------------------------- */
  /* One bar per frame, aligned to the strip above it, so the wave reads as
     "this much sound happens on this frame" without a second ruler. The lane
     itself is drawn, not just the bars: a quiet passage has to look like
     quiet, not like a track that failed to load. */
  /* As long as the row of frames (`stripExtent`): a block is only as wide as
     the strip's window, and the lane ended a screen in. */
  .wave {
    box-sizing: border-box;
    display: flex;
    gap: var(--gap, 2px);
    height: 20px;
    margin-top: 2px;
    padding: 2px;
    align-items: flex-end;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border-radius: var(--r-sm, 7px);
  }
  /* What stands in for the frames the strip has not built: the width they
     would have taken, so the scrollbar is the length it always was. */
  .gap {
    flex: none;
  }
  .bar {
    flex: none;
    display: flex;
    gap: 1px;
    align-items: flex-end;
    height: 100%;
  }
  .bar > span {
    flex: 1;
    background: var(--accent);
    opacity: 0.6;
    border-radius: 1px;
  }
  /* The wave is drawn by backgrounds, which forced colors paint as Canvas. */
  @media (forced-colors: active) {
    .bar > span {
      background: CanvasText;
    }
  }

  /* Phone: a shorter timeline and no room for a wide layer column. */
  /* No narrower than the phone row (LayerRows): 108 px of furniture, the
     name's 3rem floor and the border. At 7.5rem the handle and the bin
     were scrolled out of the column. */
  :global(:where(.studio.phone)) .layer-col {
    /* Never narrower than its row's keys (LayerRows): eye, handle and bin
       at 1rem + 8px, the tag's 16, four gaps, the padding and the border.
       Under half the strip before, at 200 % text the bin was scrolled out. */
    min-width: calc(4rem + 75px);
    width: 11.5rem;
  }
  /* One layer has nothing to be moved past and cannot be deleted: its handle
     and its bin are gone (LayerRows) and the column is as wide as what is
     left — its head and the name. It held 54 % of the strip, five frames of
     eight in sight. A width set by the divider is the hand's, and stays. */
  :global(:where(.studio.phone)) .layer-col.single {
    min-width: 0;
    width: max-content;
  }
  :global(:where(.studio.phone)) .body {
    container: strip / inline-size;
  }
  /* The phone panel grows to its contents, so here the chip is a row of
     its own, a finger's keys and the hint in full. */
  :global(:where(.studio.phone)) .pick-bar.shown {
    --key-h: 2.75rem;
    position: static;
    max-width: none;
    margin-bottom: 6px;
    padding: 0 0 0 12px;
    box-shadow: none;
  }
  :global(:where(.studio.phone)) .pick-hint {
    white-space: normal;
  }
  /* The keys would take more than half the strip: the handle folds away
     (LayerRows), and the column holds the three keys left. */
  @container strip (width < calc(8rem + 150px)) {
    .layer-col {
      min-width: calc(3rem + 63px);
    }
  }
  /* Safari 16.0 and 16.1 have no color-mix(): with a var() in it the value is
     invalid when computed and the tint went to nothing. The nearest token. */
  @supports not (color: color-mix(in srgb, red, red)) {
    .cell.selected {
      background: var(--accent-tint);
    }
    .wave {
      background: var(--accent-tint);
    }
  }
  /* --- Motion ------------------------------------------------------------ */
  @keyframes cell-in {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  /* What came still says so by its tone; it does not travel, and what is
     carried is shown by its shadow, not by growing. */
  @media (prefers-reduced-motion: reduce) {
    .cell.arrived {
      animation-name: fade-in;
    }
    .cell.lifted,
    .num.lifted {
      scale: none;
    }
  }
</style>
