<script lang="ts">
  // The reference toonio.ru timeline (`Timeline` in toonio.bundle.js:8645):
  // the layer list on the left and a layer-by-frame grid of cell thumbnails
  // on the right, filling whatever height the resizable bottom panel gives
  // it. One shape for every preset — a preset patches where the strip sits,
  // not what it is.
  import { tick, untrack } from 'svelte';
  import type { Frame, Layer } from '../format/types';
  import type { EditorState } from './editor-state.svelte';
  import { cellSize, rowHeight, rowHeightCss } from './thumb-size';
  import { fitZoom, numberEvery, scrollToFrame, stripLevel, stripTabStop, stripTail, stripWindow, wheelOnStrip, zoomAnchor, zoomBy, zoomScroll, ZOOM_MAX, ZOOM_MIN } from './strip-window';
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
  import { snappedDuration, touchDuration, timelineClips, type ClipResize } from './timeline-clips';
  import { packOffset, type ExposurePack } from '../model/exposure';
  import { keyOf } from '../model/cells';
  import { formatPercent, t } from '../i18n';
  import { notePopupClosed } from './dismiss-press';

  let { editor }: { editor: EditorState } = $props();

  // The frames or the layer that have just come: they fade in so the eye
  // finds where they landed. Found by the counts growing, not by a node being
  // built — the strip builds cells as it scrolls, and those must stand still.
  // Never under a preview: there the strip only shows which frame is up.
  // Raw: a proxy of a cell or a layer would never equal the one it stands for.
  let arrived = $state.raw<{ frames?: ReadonlySet<Frame>; layer?: Layer } | null>(null);
  let counted: { frames: number; layers: number } | null = null;
  let previousDrawings = new Set<Frame>();
  /** A newly added column takes its arrival cue from its first drawing. */
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
    const was = counted;
    const before = previousDrawings;
    counted = now;
    previousDrawings = new Set(frames.filter((cell): cell is Frame => !!cell));
    if (editor.playing) {
      arrived = null;
      return;
    }
    // The carried drawing already has a visible thumbnail. A copy crossing a
    // tick must stay visible too, even when it grows the film.
    if (!was || untrack(() => carry !== null)) return;
    if (now.layers === was.layers + 1 && now.frames === was.frames) {
      arrived = { layer: untrack(() => editor.doc.layers[editor.activeLayer]) };
      return;
    }
    if (now.frames <= was.frames) return;
    const fresh = frames.filter((cell): cell is Frame => !!cell && !before.has(cell));
    if (fresh.length > 0) arrived = { frames: new Set(fresh) };
  });

  let strip = $state<HTMLDivElement | undefined>();
  /**
   * The wheel over the names or the cells moves the strip (the names follow
   * it), and never the page under the studio — at either end as well
   * (owner, 2026-10-18). Ctrl+wheel over the cells zooms the strip to the
   * pointer (timeline-exposure-cells); over the names it is left alone.
   */
  function wheelAlong(e: WheelEvent): void {
    if (!strip) return;
    if (grip) {
      e.preventDefault();
      return;
    }
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
  function zoomAt(width: number, clientX?: number, at?: number): void {
    if (!strip || grip || carry) return;
    const to = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, width));
    if (Math.abs(to - cellW) < 0.01) return;
    const box = strip.getBoundingClientRect();
    const x = at ?? (clientX === undefined ? strip.clientWidth / 2 : clientX - box.left - strip.clientLeft);
    const toGap = to >= 14 ? GRID_GAP : 0;
    const left = zoomScroll(strip.scrollLeft, x, GRID_GAP, pitch, to + toGap);
    // The cell's own width is kept as none, so a new sheet's size still sets it.
    editor.setSetting('timelineZoom', Math.abs(to - thumbWidth) < 0.01 ? 0 : Math.round(to * 100) / 100);
    // The row is only as long as the new pitch once it is laid out.
    void tick().then(() => {
      if (!strip) return;
      strip.scrollLeft = left;
      stripScroll = strip.scrollLeft;
    });
  }

  // --- The strip's zoom keys (strip-zoom-keys) ------------------------------
  // The keys and the mouse's group keep the current frame where it is while
  // it is in view, the strip's middle otherwise.
  function zoomKeep(width: number): void {
    if (!strip) return;
    const frame = editor.displayedFrame;
    zoomAt(width, undefined, zoomAnchor(strip.scrollLeft, strip.clientWidth, GRID_GAP + timing.start(frame) * pitch, spanWidth(frame)));
  }
  const zoomStep = (direction: 1 | -1) => zoomKeep(zoomBy(cellW, -direction * 150));
  /** The whole film, the end mark clear of the group over the numbers, from its start. */
  function zoomFit(): void {
    if (!strip || grip) return;
    const to = fitZoom(strip.clientWidth, timing.total, END_MARK + (zoomGroupW ? zoomGroupW + ZOOM_INSET + 4 : 0));
    editor.setSetting('timelineZoom', Math.abs(to - thumbWidth) < 0.01 ? 0 : to);
    void tick().then(() => {
      if (!strip) return;
      strip.scrollLeft = 0;
      stripScroll = 0;
    });
  }
  $effect(() => {
    editor.stripKeys = (how) => (how === 0 ? zoomFit() : zoomStep(how));
    return () => {
      editor.stripKeys = null;
    };
  });
  // --- A pinch on the strip zooms it ----------------------------------------
  // Two fingers on the cells: their spread is the cell's width, the point
  // between them stays put. One finger still scrolls and holds as before.
  const fingers = new Map<number, number>();
  let pinch: { spread: number; width: number } | null = null;

  function onPinchDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, e.clientX);
    if (fingers.size === 2) {
      touchPan = null;
      cancelCarry();
      endGrip();
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
      // The row the end mark left behind goes once it is out of sight.
      if (heldReach && strip.scrollLeft + strip.clientWidth <= filmExtent) heldReach = 0;
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
  /**
   * Half the widest plate of the number on screen, px: four digits at the
   * head's 0.74rem and the plate's 6 px a side — it grows with the text.
   */
  function plateHalf(): number {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Math.ceil(rem * 0.74 * 0.62 * 2 + 6 + 2);
  }
  /** Room past the last tick, px: the end mark is dragged into it. */
  const END_ROOM = 48;
  /** The end mark's bracket and a breath after it, which «Весь фильм» keeps in view. */
  const END_MARK = 16;
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
  // The film made longer or shorter by its end mark or «Кадров» leaves the
  // active frame where it was: the strip stays where the hand is (owner,
  // 2026-11-17: stretching the end sent the strip back to the start).
  let seenAt = { frame: -1, opens: -1, width: -1, view: -1, sets: 0 };
  $effect(() => {
    const index = editor.activeFrame;
    const opens = editor.docOpens;
    void frameTotal;
    void filmTicks;
    const width = cellW;
    const view = stripWidth;
    // Only a length set by hand is let be: an insertion that keeps the
    // active index (Ctrl+plus) still brings the frame into view.
    const sets = editor.filmLengthSets;
    const lengthOnly = sets !== seenAt.sets && index === seenAt.frame && opens === seenAt.opens && width === seenAt.width && view === seenAt.view;
    seenAt = { frame: index, opens, width, view, sets };
    if (editor.playing || !strip || lengthOnly) return;
    untrack(() => {
      // Selecting a partially visible handle must leave its tick under the pointer.
      if (!strip || grip || touchPan || held || carry) return;
      stripScroll = strip.scrollLeft;
      // Where the frame sits is arithmetic: its cell may not be built.
      // The row's padding is the gap, so the last frame comes in ring and all.
      let to = scrollToFrame(index, cellW, gap, strip.scrollLeft, strip.clientWidth, GRID_GAP, timing) ?? strip.scrollLeft;
      // The number's plate is wider than a narrow cell: it comes into view whole too.
      const mid = GRID_GAP + timing.start(index) * pitch + spanWidth(index) / 2;
      const half = plateHalf();
      if (mid - half < to) to = Math.max(0, mid - half);
      else if (mid + half > to + strip.clientWidth) to = mid + half - strip.clientWidth;
      if (to !== strip.scrollLeft) {
        strip.scrollLeft = to;
        stripScroll = strip.scrollLeft;
      }
    });
  });

  // Keep the active row in view too: the arrows walk the layers from the
  // canvas, and with more rows than the panel is tall the active one sat
  // under the sticky frame numbers or below the fold. The rows are the same
  // arithmetic as the frames, turned on their side, below the header.
  $effect(() => {
    void layerTotal;
    void editor.activeLayer;
    void editor.docOpens;
    void row;
    void stripWidth;
    if (editor.playing || !strip) return;
    if (strip.scrollHeight <= strip.clientHeight) {
      void tick().then(revealActiveLayer);
      return;
    }
    revealActiveLayer();
  });

  function revealActiveLayer(): void {
    if (!strip) return;
    // On a phone the strip grows to its rows and the panel scrolls instead:
    // the active row (the bottom one, by default) opened under its fold.
    // The panel alone — `scrollIntoView` would scroll the host page too.
    if (strip.scrollHeight <= strip.clientHeight) {
      revealInPanel(strip.querySelector('.cell.active'));
      return;
    }
    const at = layerTotal - 1 - editor.activeLayer;
    const head = strip.querySelector<HTMLElement>('.head')?.offsetHeight ?? 0;
    // A row grows with the text past the frame's number (`rowHeightCss`).
    const rowPx = strip.querySelector<HTMLElement>('.cells')?.getBoundingClientRect().height || row;
    const to = scrollToFrame(at, rowPx, 0, strip.scrollTop, strip.clientHeight - head);
    if (to !== null) {
      strip.scrollTop = to;
    }
  }

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

  /** Transfer focus from a clicked control after a timeline shortcut. */
  export async function focusActiveCell(from: HTMLElement): Promise<void> {
    await tick();
    if (!strip || editor.playing || menu || document.activeElement !== from) return;
    // Vertical navigation can leave the frame offscreen if the strip was
    // manually scrolled. Bring its cell into the rendered window first.
    const to = scrollToFrame(editor.activeFrame, cellW, gap, strip.scrollLeft, strip.clientWidth, GRID_GAP, timing);
    if (to !== null) {
      strip.scrollLeft = to;
      stripScroll = strip.scrollLeft;
      await tick();
    }
    if (!strip || document.activeElement !== from) return;
    revealActiveLayer();
    strip.querySelector<HTMLElement>('.cell.active')?.focus({ preventScroll: true });
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

  function inSelectedClip(frame: number, layer: number): boolean {
    return editor.selectedPack.rows.some(row => row.layer === layer && frame >= row.start && frame < row.end);
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
    if (picking || e.pointerType === 'touch' || !e.isPrimary || e.button !== 0) {
      return;
    }
    if (e.shiftKey) {
      lostCell.reset();
      dragging = true;
      editor.selectCell(frame, layer, 'range');
      return;
    }
    const copy = e.ctrlKey || e.metaKey;
    if (copy && !isSelected(frame, layer)) return;
    if (!copy && !inSelectedClip(frame, layer)) {
      editor.selectCell(frame, layer);
      if (!isSelected(frame, layer)) return;
    }
    startCarry(e, frame, copy, true);
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
    if (touchPan?.pointerId === e.pointerId) {
      cancelLongPress();
      touchPan = null;
    }
    endCellDrag();
    if (e.type === 'pointercancel' && carry?.pointerId === e.pointerId) cancelCarry();
    endCarry(e);
    if (grip && e.pointerId === grip.pointerId) {
      if (e.type === 'pointerup') placeGrip(e.clientX);
      endGrip(e.type === 'pointerup');
    }
    endMark(e);
  }

  /** The window lost: no release will come — the end mark goes back. */
  function onWindowBlur(): void {
    cancelLongPress();
    touchPan = null;
    held = null;
    fingers.clear();
    pinch = null;
    cancelCarry();
    closeMenu();
    endGrip();
    endMark(undefined, true);
  }

  function onWindowMove(e: PointerEvent): void {
    if (onPinchMove(e) || panBeforeHold(e)) return;
    if (grip && e.pointerId === grip.pointerId) {
      if (lostGrip(e, mainUp)) endGrip();
      else {
        placeGrip(e.clientX);
        if (!grip.relative) markEdge(e.clientX);
      }
      return;
    }
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
    if (menu || fingers.size) return;
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const keyed = e.button !== 2 || (!e.clientX && !e.clientY);
    showMenu(el, frame, editor.activeLayer, keyed ? { x: box.left, y: box.bottom, above: box.top } : { x: e.clientX, y: e.clientY, above: e.clientY }, false, true);
  }

  function openMenu(e: MouseEvent, frame: number, layer: number): void {
    e.preventDefault();
    // A touch can send contextmenu before the hold timer. The timer opens
    // the menu and arms the drag together.
    if (menu || fingers.size) {
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
  // before the hold scrolls the strip, a lift is a tap.
  const LONG_PRESS_MS = 500;
  let longPress = 0;
  let longPressed = false;
  // The browser chooses touch-action at pointerdown. On clip hit targets
  // we therefore resolve swipe versus hold ourselves, for this same finger.
  let touchPan: { pointerId: number; x: number; y: number; left: number; top: number; moving: boolean } | null = null;

  function panBeforeHold(e: PointerEvent): boolean {
    const pan = touchPan;
    if (!strip || !pan || pan.pointerId !== e.pointerId) return false;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moving) {
      if (Math.hypot(dx, dy) < CARRY_SLOP) return true;
      cancelLongPress();
      pan.moving = true;
      strip.setPointerCapture(e.pointerId);
      carried = true;
    }
    strip.scrollLeft = pan.left - dx;
    strip.scrollTop = pan.top - dy;
    return true;
  }

  // A held finger when the strip goes (the layout steps down to the phone's)
  // would open a menu over a strip that is not there.
  $effect(() => cancelLongPress);

  function startLongPress(e: PointerEvent, frame: number, layer: number, cells = true): void {
    cancelLongPress();
    const cell = e.currentTarget as HTMLElement;
    const at = { x: e.clientX, y: e.clientY, above: e.clientY };
    const { pointerId, pointerType } = e;
    if (pointerType === 'touch' && strip) {
      touchPan = { pointerId, x: at.x, y: at.y, left: strip.scrollLeft, top: strip.scrollTop, moving: false };
    }
    longPress = window.setTimeout(() => {
      longPress = 0;
      if (menu || editor.playing) return;
      if (pointerType === 'touch') {
        if (!strip || !fingers.has(pointerId)) return;
        touchPan = null;
        held = { pointerId, x: at.x, y: at.y, frame, startX: at.x, cells };
        strip.setPointerCapture(pointerId);
      }
      longPressed = true;
      showMenu(cell, frame, layer, at, true, !cells);
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
    pack: ExposurePack | null;
    startX: number;
    startScroll: number;
    lifted: boolean;
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
    const pack = cells && !copy ? editor.selectedPack : null;
    const { from, count } = pack ?? framesToCarry(editor.selection, frame);
    lostCarry.reset();
    carry = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      from,
      at: from,
      count,
      grab: frame - from,
      pack,
      startX: e.clientX,
      startScroll: strip.scrollLeft,
      lifted: false,
      copy,
      copied: false,
      cells,
    };
    carried = false;
    arrived = null;
    editor.beginGesture();
    // The studio's keys wait, as they do for a layer drag: Z mid-carry
    // changed the strip the carry counts in.
    editor.gestureHeld = true;
  }

  /**
   * Whether the selection already is whole columns through `frame`: the
   * number's menu keeps it; one cell there is not the column the menu acts on.
   */
  function columnHeld(frame: number): boolean {
    return editor.selection.frames.includes(frame) && editor.selection.layers.length === editor.doc.layers.length;
  }

  /** Mouse and pen: the number in the head picks its frame up. */
  function onNumDown(e: PointerEvent, frame: number): void {
    longPressed = false;
    carried = false;
    if (!e.isPrimary || e.button !== 0) return;
    if (e.pointerType === 'touch') {
      if (!editor.playing && !columnHeld(frame)) editor.selectColumn(frame);
      startLongPress(e, frame, editor.activeLayer, false);
      return;
    }
    if (editor.playing) return;
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
    if (carry.pack && !carry.lifted) {
      if (Math.abs(e.clientX - carry.startX) < 3) return;
      carry.lifted = true;
      carried = true;
      cancelLongPress();
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
    const pointed = pointedTick(carry.lastX) - carry.grab;
    const want = carry.pack
      ? carry.from + packOffset(carry.pack, pointed - carry.from)
      : Math.max(0, pointed);
    // Asked before the place is compared: a copy snapped onto the place it left stands there too.
    if (carry.copy && carry.copied && want === carry.from) {
      // Back where it began: no copy stays (Krita drops a frame onto itself).
      editor.withdrawGesture();
      carry.copied = false;
      carry.at = carry.from;
      return;
    }
    if (want === carry.at) return;
    if (carry.pack && want === carry.from) {
      editor.withdrawGesture();
      carry.at = want;
      return;
    }
    // Laid again from where the drag began, every step: no step leaves anything behind.
    const landed = carry.pack
      ? editor.moveCellsInLayer(carry.pack, want - carry.from, true)
      : editor.copyCellsInLayer(carry.from, carry.count, want, true);
    if (landed === null) return;
    // A copy put down is the carry's even where it lands on the place it left.
    carry.copied = carry.copy;
    if (landed === carry.at) return;
    carry.at = landed;
    carried = true;
    cancelLongPress();
    if (menu) closeMenu();
  }

  // The document snaps at clip boundaries. Between them, the lifted artwork
  // tracks the hand while each transparent hit target stays on its own tick.
  const lifting = $derived(!!carry?.pack && carry.lifted);
  const liftTravel = $derived.by(() => {
    if (!carry?.pack || !carry.lifted) return 0;
    const { offsets } = carry.pack;
    const travel = carry.lastX - carry.startX + stripScroll - carry.startScroll;
    const distance = Math.max(offsets[0] * pitch, Math.min(offsets[offsets.length - 1] * pitch, travel));
    return distance - (carry.at - carry.from) * pitch;
  });

  function liftedSpan(layer: number) {
    if (!carry?.pack || !carry.lifted) return;
    const row = carry.pack.rows.find(row => row.layer === layer);
    if (!row) return;
    const by = carry.at - carry.from;
    return { start: row.start + by, end: row.end + by };
  }

  let dropping = $state(false);
  let dropTimer: ReturnType<typeof setTimeout>;
  $effect(() => () => clearTimeout(dropTimer));

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
    if (carry.lifted) {
      dropping = true;
      clearTimeout(dropTimer);
      dropTimer = setTimeout(() => { dropping = false; }, 160);
    }
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
    if (e.key !== 'Escape' || !(carry || grip || mark)) return;
    e.preventDefault();
    e.stopPropagation();
    cancelCarry();
    endGrip();
    endMark(undefined, true);
  }

  // Preview the new span under the pointer. Only a release writes the document,
  // so Escape and a cancelled touch also preserve the existing redo history.
  let grip = $state.raw<{
    pointerId: number; origin: number; pitch: number; relative: boolean; frame: number; layer: number;
    doc: EditorState['doc']; range: EditorState['activeExposure'];
  } | null>(null);
  let gripDuration = $state(1);
  const previewTicks = $derived(grip
    ? frameTotal + Math.max(0, gripDuration - grip.range.duration - grip.range.spare)
    : frameTotal);
  let settlingLayer = $state<number | null>(null);
  let settleTimer: ReturnType<typeof setTimeout>;
  $effect(() => () => clearTimeout(settleTimer));
  let gripX = 0;
  const lostGrip = createLostRelease();

  function onGripDown(e: PointerEvent, frame: number, layer: number): void {
    if (!strip || editor.gestureHeld || pinch || picking || editor.playing || editor.layerLocked(layer)
      || !e.isPrimary || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    e.preventDefault();
    closeMenu();
    editor.selectCell(frame, layer);
    if (editor.activeFrame !== frame || editor.activeLayer !== layer) return;
    const range = editor.activeExposure;
    // Touch resizing measures only the finger's movement.
    // On a narrow strip, resting near its edge used to keep resizing the clip.
    const relative = e.pointerType === 'touch';
    const origin = e.clientX + (relative ? 0 : strip.scrollLeft);
    grip = { pointerId: e.pointerId, origin, pitch, relative, frame, layer, doc: editor.doc, range };
    gripDuration = range.duration;
    settlingLayer = null;
    gripX = e.clientX;
    lostGrip.reset();
    strip.setPointerCapture(e.pointerId);
    editor.gestureHeld = true;
  }

  function placeGrip(clientX: number): void {
    if (!grip || !strip) return;
    gripX = clientX;
    const { duration, maxDuration } = grip.range;
    gripDuration = grip.relative
      ? touchDuration(duration, maxDuration, clientX - grip.origin, grip.pitch, gripDuration)
      : snappedDuration(duration, maxDuration, clientX + strip.scrollLeft - grip.origin, grip.pitch);
  }

  function endGrip(commit = false): void {
    if (!grip) return;
    const target = grip;
    settlingLayer = target.layer;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settlingLayer = null; }, 200);
    grip = null;
    stopMarkScroll();
    if (strip?.hasPointerCapture(target.pointerId)) strip.releasePointerCapture(target.pointerId);
    editor.gestureHeld = false;
    carried = true;
    if (commit && editor.doc === target.doc && editor.activeLayer === target.layer && editor.activeFrame === target.frame) {
      editor.setExposureDuration(gripDuration);
    }
  }

  /** Whether cell `i` of the layer is the last of its drawing's time: its band ends there. */
  function endsDrawing(layer: number, i: number): boolean {
    const frames = editor.doc.layers[layer].frames;
    return i + 1 >= frames.length || frames[i + 1] !== null;
  }

  // --- The end of the film, by its mark ---------------------------------------
  // A mark after the last tick: dragged, the film is as long as where it is let
  // go. Longer continues every layer; shorter asks first when drawings go.
  let mark = $state<{ pointerId: number; startX: number; from: number; to: number; reach: number } | null>(null);
  /** A release outside the window sends no pointerup: the next move with no button ends the drag. */
  const lostMark = createLostRelease();

  function onMarkDown(e: PointerEvent): void {
    if (grip || editor.playing || !e.isPrimary || (e.pointerType !== 'touch' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    lostMark.reset();
    // The row a previous drag left stays under this one too.
    mark = { pointerId: e.pointerId, startX: e.clientX, from: frameTotal, to: frameTotal, reach: Math.max(frameTotal, heldReach) };
    markX = e.clientX;
    if (strip) {
      const box = strip.getBoundingClientRect();
      markGrab = e.clientX - box.left - strip.clientLeft + strip.scrollLeft - GRID_GAP;
    }
    editor.gestureHeld = true;
  }

  function onMarkMove(e: PointerEvent): void {
    if (!mark || e.pointerId !== mark.pointerId) return;
    // Let go outside the window: the length is not asked for by a hand that is gone.
    if (lostMark(e, mainUp)) {
      endMark(undefined, true);
      return;
    }
    markX = e.clientX;
    placeMark();
    markEdge(e.clientX);
  }

  /** The tick under the hand is the film's new end; the strip's scroll counts. */
  function placeMark(): void {
    if (!mark || !strip) return;
    const box = strip.getBoundingClientRect();
    const x = markX - box.left - strip.clientLeft + strip.scrollLeft - GRID_GAP;
    mark.to = Math.max(1, mark.from + Math.round((x - markGrab) / pitch));
    mark.reach = Math.max(mark.reach, mark.to);
  }
  /** The ticks a finished drag of the end mark reached: the row stays that long until scrolled back. */
  let heldReach = $state(0);
  // Another draft opened: its row is its own.
  $effect(() => {
    void editor.docOpens;
    untrack(() => (heldReach = 0));
  });
  /** Where in the row the mark was taken, so the film does not jump at the first move. */
  let markGrab = 0;

  // Held at the strip's edge — or at the zoom group, which stands over it —
  // the strip runs on, so a film is made longer than the window is wide
  // (owner, 2026-11-17: at 441 frames the group was in the way).
  let markX = 0;
  let markScroll = 0;
  let markDirection: -1 | 0 | 1 = 0;
  function markEdge(clientX: number): void {
    if (!strip) return;
    const box = strip.getBoundingClientRect();
    const right = box.right - (!grip && zoomGroupW ? zoomGroupW + stripBar + ZOOM_INSET : 0);
    const direction: -1 | 0 | 1 =
      clientX - box.left < CARRY_EDGE ? -1 : right - clientX < CARRY_EDGE ? 1 : 0;
    if (direction === markDirection) return;
    stopMarkScroll();
    if (direction === 0) return;
    markDirection = direction;
    markScroll = window.setInterval(() => {
      strip?.scrollBy({ left: direction * Math.max(pitch * 2, 16) });
      if (grip) placeGrip(gripX);
      else placeMark();
    }, 50);
  }

  function stopMarkScroll(): void {
    clearInterval(markScroll);
    markScroll = 0;
    markDirection = 0;
  }
  // The studio closed mid-drag: no release will reach the timer.
  $effect(() => () => stopMarkScroll());

  function endMark(e?: PointerEvent, cancel = false): void {
    if (!mark || (e && e.pointerId !== mark.pointerId)) return;
    const to = mark.to;
    stopMarkScroll();
    // A film let go shorter than the drag reached keeps the row it had, so
    // the scroll stays where the hand stopped (owner, 2026-11-17).
    heldReach = mark.reach;
    mark = null;
    editor.gestureHeld = false;
    if (!cancel) editor.setFilmLength(to);
  }

  /** Where the end mark stands: the film's end, or where the hand has it. */
  const markAt = (): number => (mark?.to ?? previewTicks) * pitch + GRID_GAP - gap / 2;

  // Native pan is available in the gaps. A pinch or an editing gesture owns
  // the strip until its fingers lift.
  $effect(() => {
    const grid = strip;
    if (!grid) return;
    const still = (e: TouchEvent) => {
      if (e.cancelable && (held || carry || pinch || grip || mark)) e.preventDefault();
    };
    grid.addEventListener('touchmove', still, { passive: false, capture: true });
    return () => {
      grid.removeEventListener('touchmove', still, true);
      stopCarryScroll();
      endGrip();
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
      if (!columnHeld(frame)) editor.selectColumn(frame);
    } else if (!isSelected(frame, layer) && !(finger && spanned && inSelectedClip(frame, layer))) {
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
      menuEl.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: finger });
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
  /** The cells' width as a share of their own (a frame's thumbnail): 100 % is unzoomed. */
  const zoomPercent = $derived(formatPercent(cellW / thumbWidth));
  /** The group's breath from the strip's right edge, as from the head's top and bottom (owner, 2026-11-17). */
  const ZOOM_INSET = 6;
  /** The group's width over the numbers (0 where there is none: a touch screen). */
  let zoomGroupW = $state(0);
  /** The strip's own scrollbar, which the group keeps clear of. */
  const stripBar = $derived(strip && stripWidth ? strip.offsetWidth - strip.clientWidth : 0);

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
  const clipView = $derived(grip
    ? stripWindow(previewTicks, cellW, gap, stripScroll, stripWidth)
    : view);
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
  // Past the end: room to drag the end mark into, and with a mouse the zoom
  // group's width, so the mark scrolls out from under it; a dragged mark
  // longer than the film takes the row with it — and keeps it as long as the
  // drag lasts, so a step back left does not shrink the row under the scroll
  // and throw the strip back (owner, 2026-11-17).
  const stripExtent = $derived(
    Math.max(timing.total, mark?.reach ?? heldReach, previewTicks) * pitch + GRID_GAP + END_ROOM + (zoomGroupW ? zoomGroupW + ZOOM_INSET : 0),
  );
  /** The row the film alone needs, past which a held reach is only slack. */
  const filmExtent = $derived(timing.total * pitch + GRID_GAP + END_ROOM + (zoomGroupW ? zoomGroupW + ZOOM_INSET : 0));

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

  function previewResize(layer: number): ClipResize | undefined {
    return grip?.layer === layer
      ? { start: grip.range.start, duration: grip.range.duration, to: gripDuration }
      : undefined;
  }

  // All previews are absolutely positioned. Give them a stable DOM order:
  // re-inserting a keyed node during a swap cancels its CSS transition.
  const paintOrder = new WeakMap<Frame, number>();
  let nextOrder = 0;
  function clipPreviews(frames: readonly (Frame | null)[], first: number, end: number, resize?: ClipResize) {
    const clips = timelineClips(frames, first, end, resize);
    for (const { frame } of clips) {
      if (frame && !paintOrder.has(frame)) paintOrder.set(frame, nextOrder++);
    }
    return clips.sort((a, b) => (a.frame ? paintOrder.get(a.frame)! : -1) - (b.frame ? paintOrder.get(b.frame)! : -1));
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
    resize?: ClipResize;
    lifted?: { start: number; end: number };
    tone: string;
  }

  /**
   * A row of bands on one canvas: each drawing a bar as long as it lasts, an
   * empty drawing hollow, the frame on screen a column of the accent. The
   * colours are the studio's own, read off the strip.
   */
  function drawBands(canvas: HTMLCanvasElement, bands: Bands) {
    const motion = matchMedia('(prefers-reduced-motion: no-preference)');
    let positions = new Map<Frame, number>();
    let wasLifted = false;
    let raf = 0;
    const paint = (b: Bands) => {
      cancelAnimationFrame(raf);
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
      const tall = b.height - 4;
      const tone = look.getPropertyValue(b.tone).trim() || ink;
      const easing = motion.matches && (b.lifted || wasLifted);
      wasLifted = !!b.lifted;
      const spans = timelineClips(b.frames, b.first, b.first + b.count, b.resize).map(clip => {
        const held = !!b.lifted && clip.key >= b.lifted.start && clip.key < b.lifted.end;
        const from = easing && !held && clip.frame ? positions.get(clip.frame) ?? clip.start : clip.start;
        return { clip, held, from };
      });
      // Paint the raised clip last as its neighbors pass underneath.
      if (b.lifted) spans.sort((a, b) => Number(a.held) - Number(b.held));
      positions = new Map();
      const moving = spans.some(({ from, clip }) => from !== clip.start);
      const start = performance.now();
      const cssTime = look.getPropertyValue('--dur-fast').trim();
      const duration = parseFloat(cssTime) * (cssTime.endsWith('ms') ? 1 : 1000);
      const draw = (now: number) => {
        const progress = moving && duration > 0 ? Math.min(1, Math.max(0, now - start) / duration) : 1;
        const remaining = (1 - progress) ** 3;
        ctx.clearRect(0, 0, width, b.height);
        for (const { clip, held, from } of spans) {
          const pos = clip.start + (from - clip.start) * remaining;
          if (clip.frame) positions.set(clip.frame, pos);
          const top = held ? 0 : 2;
          const x = (pos - b.first) * b.pitch;
          const w = Math.max(1, (clip.end - clip.start) * b.pitch - 1);
          if (held) ctx.clearRect(x, top, w, tall);
          ctx.fillStyle = tone;
          ctx.globalAlpha = clip.frame?.strokes.length ? 0.22 : 0.08;
          ctx.fillRect(x, top, w, tall);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = held ? accent : ink;
          ctx.strokeRect(x + 0.5, top + 0.5, Math.max(0, w - 1), tall - 1);
          if (clip.frame?.strokes.length) ctx.fillRect(x + 1, top + 1, Math.min(w - 1, b.pitch - 1), tall - 2);
        }
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.14;
        for (const i of b.selected) {
          if (i >= b.first && i < b.first + b.count) ctx.fillRect((i - b.first) * b.pitch, 0, b.pitch, b.height);
        }
        ctx.globalAlpha = 1;
        if (b.now >= b.first && b.now < b.first + b.count) {
          ctx.fillStyle = accent;
          ctx.fillRect((b.now - b.first) * b.pitch, 0, Math.max(1, b.pitch), 2);
          ctx.fillRect((b.now - b.first) * b.pitch, b.height - 2, Math.max(1, b.pitch), 2);
        }
        if (progress < 1) raf = requestAnimationFrame(draw);
      };
      draw(start);
    };
    paint(bands);
    return { update: paint, destroy: () => cancelAnimationFrame(raf) };
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


{#snippet durationGrip(frame: number, layer: number, bandEdge?: number)}
  {#if !editor.playing && !editor.layerLocked(layer) && !picking}
    <!-- The menu offers the same change by keyboard or tap. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="grip" class:band-grip={bandEdge !== undefined}
      style:left={bandEdge === undefined ? undefined : `${bandEdge}px`}
      aria-hidden="true" title={t('timeline.duration_drag')}
      onpointerdown={(e) => onGripDown(e, frame, layer)}></span>
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
  <div class="pick-bar" class:shown={picking || (spanned && !editor.playing)} style:--col="{colPx}px" style:--zoom-room="{zoomGroupW ? zoomGroupW + stripBar + ZOOM_INSET + 6 : 0}px">
    <!-- The way out leads, as a selection's bar does in Material and in
         Google Photos: «✕», what is picked, then what can be done to it. -->
    {#if spanned && !editor.playing && !picking}
      <button class="bar-key" title={t('timeline.clear_selection')} aria-label={t('timeline.clear_selection')} onclick={() => editor.collapseSelection()}>
        <Icon name="x" size={16} />
      </button>
    {/if}
    <p role="status" aria-live="polite">{spanned || picking ? spanText : ''}</p>
    {#if picking}
      <span class="pick-hint">{t('timeline.pick_hint')}</span>
    {/if}
    <!-- The keys stay one group: on a phone too narrow for the words and the
         keys in one row they go under the words together, not one by one. -->
    <span class="pick-keys" class:actions={spanned && !editor.playing && !picking}>
    {#if picking}
      <button class="key primary" onclick={endPicking}>{t('timeline.pick_done')}</button>
    {:else if spanned && !editor.playing}
      <button class="bar-key" title={duplicateTitle} aria-label={duplicateTitle} disabled={!editor.canDuplicateFrames} onclick={() => editor.duplicateActiveFrame()}>
        <Icon name="duplicate" size={16} />
      </button>
      <button class="bar-key" title={t('panel.item.copy')} aria-label={t('panel.item.copy')} onclick={() => editor.copySelection()}>
        <Icon name="copy" size={16} />
      </button>
      <button class="bar-key" title={t('panel.item.paste')} aria-label={t('panel.item.paste')} disabled={!editor.canPasteCells} onclick={() => editor.pasteSelection()}>
        <Icon name="paste" size={16} />
      </button>
      <button class="bar-key" title={t('panel.item.delete_frames', span)} aria-label={t('panel.item.delete_frames', span)} disabled={!editor.canRemoveFrame} onclick={() => editor.removeActiveFrame()}>
        <Icon name="trash" size={16} />
      </button>
    {/if}
    </span>
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
      class:dropping={dropping && !carry}
      style:--carry-travel="{liftTravel}px"
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
            data-col={i}
            style:width="{spanWidth(i)}px"
            class:onion={onionFrames.includes(i)}
            class:copied={editor.isCopiedFrame(i)}
            class:now={i === editor.displayedFrame}
            class:picked={!lifting && editor.selection.frames.includes(i)}
            onpointerdown={(e) => onNumDown(e, i)}
            onclick={(e) => onNumClick(e, i)}
            oncontextmenu={(e) => openColumnMenu(e, i)}
            onpointerup={cancelLongPress}
            onpointercancel={cancelLongPress}
            onpointerleave={cancelLongPress}
            title={onionFrames.includes(i) ? t('timeline.frame_onion', { n: i + 1 }) : t('timeline.frame', { n: i + 1 })}
          >{#if (i + 1) % (fps * secondsEvery) === 0}<span class="sec" aria-hidden="true">{t('timeline.seconds', { n: (i + 1) / fps })}</span>{/if}{#if named(i)}<span class="n">{i + 1}</span>{/if}</span>
        {/each}
        {#if view.after > 0}
          <span class="gap" style:width="{view.after}px" aria-hidden="true"></span>
        {/if}
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
        {@const resize = previewResize(layerIndex)}
        {@const lifted = liftedSpan(layerIndex)}
        {@const visible = resize ? clipView : view}
        {@const slots = level === 'bands' ? visible : view}
        {@const tone = `--layer-tag-${editor.layerColor(layerIndex)}`}
        <div class="cells" style:height={rowHeightCss(editor.doc)} class:resizing={!!resize} class:lifting={!!lifted}
          class:settling={!carry && (layerIndex === settlingLayer || (!!menu && !menu.column && layerIndex === editor.activeLayer))}
          style:--clip-tone={`var(${tone})`} class:current={layerIndex === editor.activeLayer} class:arrived={arrived?.layer === editor.doc.layers[layerIndex]}>
          {#if slots.before > 0}
            <span class="gap" style:width="{slots.before}px" aria-hidden="true"></span>
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
              style:width="{visible.count * pitch}px"
              style:height="{cell.h + 2}px"
              use:drawBands={{ frames: editor.doc.layers[layerIndex].frames, doc: editor.doc, first: visible.first, count: visible.count, pitch, height: cell.h + 2, now: editor.displayedFrame, resize, tone, lifted, selected: !lifting && editor.selection.layers.includes(layerIndex) ? editor.selection.frames : [] }}
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
            {#if layerIndex === editor.activeLayer}
              {@const range = editor.activeExposure}
              {@const end = range.start + range.duration}
              {#if end > firstBuilt && end <= firstBuilt + countBuilt}
                {#if !resize}
                  {@render durationGrip(end - 1, layerIndex, GRID_GAP + end * pitch)}
                {/if}
              {/if}
            {/if}
            {#if resize}
              <span class="duration-preview overview-duration" aria-hidden="true"
                style:left="{GRID_GAP + (resize.start + resize.to) * pitch}px">{gripDuration}</span>
            {/if}
          {:else}
          {#each clipPreviews(editor.doc.layers[layerIndex].frames, visible.first, visible.first + visible.count, resize) as clip (clip.frame ?? clip.key)}
            {@const editing = resize?.start === clip.key}
            <div class="exposure-clip" class:editing class:lifted={lifted && clip.key >= lifted.start && clip.key < lifted.end} data-clip={clip.key}
              class:arrived={clip.frame !== null && !!arrived?.frames?.has(clip.frame)}
              class:dim={editor.doc.layers[layerIndex].hidden}
              aria-hidden="true"
              style:transform={`translateX(calc(${GRID_GAP + clip.start * pitch}px + var(--clip-travel)))`} style:width="{(clip.end - clip.start) * pitch - gap}px"
              style:height="{cell.h + 2}px">
              <span class="clip-thumbnail" style:width="{cellW}px">
                {#if clip.frame?.strokes.length}
                  <LayerThumb doc={editor.doc} {layerIndex} frameIndex={clip.key}
                    maxW={cellW} maxH={cell.h + 2} />
                {:else}
                  <span class="ring"></span>
                {/if}
              </span>
              {#if editing}
                <span class="duration-preview">{gripDuration}</span>
              {/if}
            </div>
          {/each}
          {#each built as i (i)}
            {@const kind = kindOf(layerIndex, i)}
            <button
              class="cell clip-hit"
              style:width="{spanWidth(i)}px"
              style:height="{cell.h + 2}px"
              class:active={i === editor.displayedFrame && layerIndex === editor.activeLayer}
              class:now={i === editor.displayedFrame}
              class:continued={kind === 'continued'}
              class:blank={kind === 'blank'}
              class:marks={level === 'marks'}
              class:selected={isSelected(i, layerIndex)}
              class:copied={editor.isCopiedCell(i, layerIndex)}
              class:dim={editor.doc.layers[layerIndex].hidden}
              class:arrived={arrived?.frames?.has(columnKey(i) as Frame) ?? false}
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
              {#if endsDrawing(layerIndex, i)}
                {@render durationGrip(i, layerIndex)}
              {/if}
            </button>
          {/each}
          {/if}
          {#if slots.after > 0}
            <span class="gap" style:width="{slots.after}px" aria-hidden="true"></span>
          {/if}
        </div>
      {/each}
      {@render wave(cellW)}
    </div>
    <!-- The strip's zoom for a mouse (strip-zoom-keys), as the sheet's own
         (ScaleMenu): narrower, the scale — pressed, back to 100 % — wider,
         the whole film. Over the right end of the numbers, as Animate keeps
         its slider in the timeline's head; out of the row, so the row's
         arithmetic is untouched. A touch screen has the pinch and no group. -->
    <div
      class="zoom-group"
      role="group"
      aria-label={t('timeline.zoom_group')}
      bind:clientWidth={zoomGroupW}
      style:right="{stripBar + ZOOM_INSET}px"
    >
      <button class="bar-key" aria-disabled={cellW <= ZOOM_MIN} onclick={() => cellW <= ZOOM_MIN || zoomStep(-1)} title={t('timeline.zoom_out')} aria-label={t('timeline.zoom_out')}>
        <Icon name="minus" size={14} />
      </button>
      <button class="bar-key value" onclick={() => zoomKeep(thumbWidth)} title={t('timeline.zoom_reset')} aria-label={t('timeline.zoom_value', { percent: zoomPercent })}>{zoomPercent}</button>
      <button class="bar-key" aria-disabled={cellW >= ZOOM_MAX} onclick={() => cellW >= ZOOM_MAX || zoomStep(1)} title={t('timeline.zoom_in')} aria-label={t('timeline.zoom_in')}>
        <Icon name="plus" size={14} />
      </button>
      <button class="bar-key" onclick={zoomFit} title={t('timeline.zoom_fit')} aria-label={t('timeline.zoom_fit')}>
        <Icon name="fit-width" size={14} />
      </button>
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
      <button role="menuitem" aria-keyshortcuts={menuKey('add')?.aria} disabled={!editor.canKeyColumns} onclick={() => run(() => editor.keyPickedColumns())}>
        <Icon name="plus" size={16} /><span>{t('panel.item.key_columns')}</span>{@render key('add')}
      </button>
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
    {#if !spanned}
      {@const range = editor.activeExposure}
      {@const locked = editor.playing || editor.layerLocked(editor.activeLayer)}
      <div class="duration" role="group" aria-label={t('timeline.duration')}>
        <span>{t('timeline.duration')}</span>
        <button role="menuitem" aria-label={t('timeline.duration_less')} title={t('timeline.duration_less')} disabled={locked || range.duration <= 1} onclick={() => editor.setExposureDuration(range.duration - 1)}>
          <Icon name="minus" size={16} />
        </button>
        <output aria-live="polite">{range.duration}</output>
        <button role="menuitem" aria-label={t('timeline.duration_more')} title={t('timeline.duration_more')} disabled={locked || range.duration >= range.maxDuration} onclick={() => editor.setExposureDuration(range.duration + 1)}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    {/if}
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
    /* The zoom group stands over the numbers' right end, and knows how
       narrow the panel is wherever the panels were arranged. */
    position: relative;
    container: zoom / inline-size;
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
  /* The number on screen is a plate of its own over its tick, as wide as its
     digits: inside a cell narrowed by the zoom it was cut to a sliver. */
  .num.now {
    background: none;
    text-decoration: none;
  }
  .num.now .n {
    position: absolute;
    z-index: 1;
    left: 50%;
    top: 0.3rem;
    translate: -50% 0;
    min-width: 1.4rem;
    box-sizing: border-box;
    padding: 0 6px;
    line-height: 1.4rem;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--canvas);
    text-align: center;
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
  /* Carrying inserts whole clips at their boundaries. The ruler and the transparent
     hit targets keep their geometry throughout the gesture. */
  .grid :is(.cell, .num, .bands) {
    touch-action: none;
  }
  .grid.carrying {
    -webkit-user-select: none;
    user-select: none;
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
    --clip-radius: 5px;
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
  /* --- The film's end ---------------------------------------------------- */
  /* Not a line (owner, 2026-11-17: a line at the end read as a cursor).
     Past the end the strip is hatched: there is no film there.
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
  /* One visual clip per drawing. Per-tick buttons above it retain the
     editor's hit targets, keyboard navigation and selection semantics. */
  .exposure-clip {
    --clip-travel: 0px;
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    overflow: hidden;
    pointer-events: none;
    border-radius: var(--clip-radius);
    background: color-mix(in srgb, var(--clip-tone) 13%, var(--canvas));
  }
  .exposure-clip::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 1px solid color-mix(in srgb, var(--clip-tone) 52%, var(--edge));
    border-radius: inherit;
  }
  .exposure-clip.lifted {
    --clip-travel: var(--carry-travel);
    z-index: 2;
    box-shadow: 0 3px 6px color-mix(in srgb, var(--ink) 22%, transparent);
  }
  .exposure-clip.lifted::before { border: 2px solid var(--accent); }
  .cells.lifting .cell { opacity: 0; }
  @media (prefers-reduced-motion: no-preference) {
    .exposure-clip {
      transition: translate var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
    }
    .exposure-clip.lifted { translate: 0 -3px; }
    .cells.lifting .exposure-clip:not(.lifted),
    .grid.dropping .exposure-clip {
      transition-property: translate, box-shadow, transform;
    }
  }
  .exposure-clip.editing::before { border: 2px solid var(--accent); }
  .clip-thumbnail {
    flex: none;
    display: grid;
    place-items: center;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    background: var(--canvas);
  }
  .exposure-clip.dim .clip-thumbnail { opacity: 0.35; }
  /* The current tick sits inside its clip. Other layers share just the
     column wash; the outline belongs to the one frame under the playhead. */
  .cells .clip-hit.now {
    box-shadow: none;
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .cells .clip-hit.active {
    box-shadow: none;
    border: 0;
    background: transparent;
  }
  .clip-hit.active::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--accent);
    border-radius: inherit;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    pointer-events: none;
  }
  .ring {
    box-sizing: border-box;
    width: min(10px, calc(100% - 4px));
    aspect-ratio: 1;
    border: 2px solid var(--ink-2);
    border-radius: 50%;
  }
  .cell.clip-hit {
    position: relative;
    border-radius: var(--clip-radius);
    background: transparent;
    border-color: transparent;
  }
  /* A visible edge for the drawing, with room to take it by mouse or finger. */
  /* Inside the cell, at its right edge: a drawing's cell clips what sticks out. */
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: min(12px, 35%);
    z-index: 1;
    cursor: ew-resize;
    touch-action: none;
  }
  .grip::after {
    content: '';
    position: absolute;
    top: 20%;
    bottom: 20%;
    right: 1px;
    width: 2px;
    border-radius: 1px;
    background: var(--edge);
  }
  @media (hover: hover) {
    .cell:hover > .grip::after,
    .grip:hover::after {
      background: var(--accent);
    }
  }
  .cell.active > .grip::after {
    background: var(--accent);
  }
  @media (pointer: coarse) and (orientation: portrait) and (max-width: 767px) {
    .cell .grip { width: min(24px, 45%); }
    .grip::after { width: 4px; right: 2px; border-radius: var(--r-pill); }
  }
  /* At overview zoom the active drawing gets one handle below the band.
     The middle of the canvas remains available for selecting a tick. */
  .grip.band-grip {
    top: auto;
    bottom: 2px;
    right: auto;
    width: 12px;
    height: 35%;
    transform: translateX(-100%);
  }
  .band-grip::after {
    background: var(--accent);
  }
  .duration-preview {
    position: absolute;
    inset-inline-end: 4px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--accent);
    color: var(--canvas);
    font-size: 0.7rem;
    line-height: 1.25;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .overview-duration {
    inset-inline-end: auto;
    transform: translateX(-100%);
    pointer-events: none;
  }
  .cells.resizing .cell { opacity: 0; }
  .exposure-clip.editing::after {
    content: '';
    position: absolute;
    right: 0;
    height: 60%;
    width: 2px;
    background: var(--accent);
  }
  /* Only editing animates geometry. Both the end and the next clip target
     the same tick on each step; zooming and playback stay immediate. */
  @media (prefers-reduced-motion: no-preference) {
    .cells:is(.resizing, .settling) .exposure-clip {
      transition: width var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
    }
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
  .clip-hit.copied:not(.active) { border-color: var(--ink-2); }
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
  .exposure-clip.arrived { animation: fade-in var(--dur-enter) var(--ease-out); }
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
    .clip-hit.active::after { border-color: Highlight; }
    .cell.active {
      border: 3px solid Highlight;
    }
    .cell.selected {
      border-color: Highlight;
    }
    .num.onion {
      text-decoration-thickness: 2px;
    }
    /* The number on screen keeps its plate: the system's own highlight. */
    .num.now .n {
      background: Highlight;
      color: HighlightText;
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
  /* --- The strip's zoom (strip-zoom-keys) -------------------------------- */
  /* The head row's height, over its right end: the numbers under it are the
     ones past the strip's edge anyway. A mouse's only: a touch screen pinches. */
  .zoom-group {
    display: none;
  }
  @media (any-pointer: fine) {
    .zoom-group {
      /* The Dense-Timeline Rule: a key in the strip is 24 px and up. */
      --key-h: 1.75rem;
      position: absolute;
      top: calc((2.75rem - var(--key-h) - 4px) / 2);
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border-radius: var(--r-md);
      background: var(--paper);
      font-size: 0.75rem;
    }
  }
  .bar-key {
    flex: none;
    display: grid;
    place-items: center;
    min-width: var(--key-h);
    min-height: var(--key-h);
    padding: 0;
    border: none;
    border-radius: calc(var(--r-md) - 2px);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .bar-key.value {
    min-width: 3.2rem;
    font-variant-numeric: tabular-nums;
  }
  @media (hover: hover) {
    .bar-key:hover:not([aria-disabled='true'], :disabled) {
      background: var(--hairline-soft);
    }
  }
  .bar-key[aria-disabled='true'],
  .bar-key:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* A narrow window with a mouse (the panel under 480 px, the layer column
     in it): the scale gives way to the frames it
     would cover; the steps and the whole film stay. */
  @container zoom (width < 30rem) {
    .bar-key.value {
      display: none;
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
  /* The strip's toolbar, one language with the zoom group beside it (owner,
     2026-11-17: the white chip with the menu shadow and its white discs
     looked pasted on): paper tone, no shadow, the same 28 px keys, laid in
     the head row at the group's height. Over the numbers rather than a row
     of its own: the panel is often only a row of cells tall, and a row taken
     from it hid the cells being picked. Not above the strip either — there
     it hid the transport keys (WCAG 2.4.11). Short of the layer column. */
  .pick-bar.shown {
    /* The Dense-Timeline Rule: a key in the strip is 24 px and up. */
    --key-h: 1.75rem;
    position: absolute;
    /* Left of the zoom group, which it would otherwise cover. */
    right: var(--zoom-room, 0px);
    top: calc((2.75rem - var(--key-h) - 4px) / 2);
    /* Over the strip's own layers (the sticky head, the carried cells), but
       under what opens from a key: on the phone a layer's settings opened
       up across it and the chip lay over them (owner, 2026-11-17). */
    z-index: var(--z-float);
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - var(--col, 0px) - var(--zoom-room, 0px) - 8px);
    box-sizing: border-box;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--paper);
    font-size: 0.75rem;
    animation: fade-in var(--dur-enter) var(--ease-out);
  }
  .pick-keys {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }
  /* What is picked and what can be done to it, parted by a hair. */
  .pick-keys.actions {
    padding-left: 4px;
    border-left: 1px solid var(--hairline);
  }
  .pick-bar p {
    margin: 0 6px 0 2px;
    white-space: nowrap;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--accent-ink);
  }
  /* Picking has no «✕» to lead: the words take the edge's breath instead. */
  .pick-bar p:first-child {
    margin-left: 8px;
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
  .frame-menu .duration {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--key-h, 2.75rem);
    padding: 0 4px 0 36px;
  }
  .frame-menu .duration button {
    padding: 0 8px;
  }
  .frame-menu output {
    min-width: 2ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
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
    container: strip zoom / inline-size;
  }
  /* The phone panel grows to its contents, so here the chip is a row of
     its own, a finger's keys and the hint in full. */
  :global(:where(.studio.phone)) .pick-bar.shown {
    --key-h: 2.75rem;
    position: static;
    max-width: none;
    margin-bottom: 6px;
    padding: 2px;
    font-size: 0.875rem;
    /* Words and five finger keys are wider than a 390 px phone: the keys
       go under the words rather than off the edge (owner, 2026-11-17), and
       at a large text size they wrap among themselves too. */
    flex-wrap: wrap;
    row-gap: 4px;
  }
  /* Wrapped under the words, a hair at the keys' left would stand alone. */
  :global(:where(.studio.phone)) .pick-keys.actions {
    padding-left: 0;
    border-left: none;
  }
  :global(:where(.studio.phone)) .pick-keys {
    flex-wrap: wrap;
    justify-content: flex-end;
    row-gap: 4px;
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
  /* Newly added frames can still appear by tone alone. */
  @media (prefers-reduced-motion: reduce) {
    .cell.arrived {
      animation-name: fade-in;
    }
  }
</style>
