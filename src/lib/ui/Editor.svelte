<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { plugins } from '../plugins';
  import { EditorState } from './editor-state.svelte';
  import CanvasView from './CanvasView.svelte';
  import BrushPanel from './BrushPanel.svelte';
  import ColoursPanel from './ColoursPanel.svelte';
  import PopKey from './PopKey.svelte';
  import { notePopupClosed } from './dismiss-press';
  import { sideAsDrawn, transportKeys } from './ux-profile';
  import BrushRail from './BrushRail.svelte';
  import BrushSizes from './BrushSizes.svelte';
  import ColorPanel from './ColorPanel.svelte';
  import PaletteBox from './PaletteBox.svelte';
  import ToolKey from './ToolKey.svelte';
  import FloatWindow from './FloatWindow.svelte';
  import PanelArranger from './PanelArranger.svelte';
  import TransformMenu from './TransformMenu.svelte';
  import ScaleMenu from './ScaleMenu.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import AudioPanel from './AudioPanel.svelte';
  import Timeline from './Timeline.svelte';
  import PlayControls from './PlayControls.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import DraftsHub from './DraftsHub.svelte';
  import PluginsSheet from './PluginsSheet.svelte';
  import Icon from './Icon.svelte';
  import './tokens.css';
  import './controls.css';
  import { decodeLegacyJson, decodeToon, isToonopJson } from '../format/toon-decode';
  import { FormatError, loadDocument } from '../format/validate';
  import { frameCount, isEmptyDocument } from '../model/operations';
  import { draftSizeClass, formatFileSize } from './file-size';
  import { saveFile } from './save-file';
  import { keyPan, zoomDelta } from './viewport';
  import { extendTarget, fpsFromField, frameKeyTitle, frameMenuKey, wrapIndex, type FrameMenuAction } from './frame-selection';
  import { composing, focusOrigin, keyOwner, latinKey, panSheetKey, repeats, typesText } from './key-owner';
  import { focusHeir, twinSelector } from './focus-heir';
  import { draftEntries } from '../draft/restore';
  import {
    deleteAllDrafts,
    deleteDraft,
    duplicateDraft,
    exportDrafts,
    importDrafts,
    listDrafts,
    newDraftId,
    saveDraft,
    setDraftAudio,
    setDraftCredits,
    setDraftScreenshot,
  } from '../draft/store';
  import { renderScreenshot } from '../export/preview-webp';
  import type { AudioTrackData } from '../audio/state.svelte';
  import { isAudioFile } from '../audio/track';
  import {
    PANEL_HEIGHT_AUDIO,
    PANEL_HEIGHT_MIN,
    PANEL_ROW_STEP,
    SIDE_WIDTH_MAX,
    SIDE_WIDTH_MIN,
  } from './presets';
  import { columnDraws, itemDrawn, panelItem as panelItemSpec, stageRailShown, toolOfItem, toolOpensBrush, toolSpec } from './panels';
  import { DEFAULT_PRESET, presetPanels, presets, presetUx, type SideId } from './presets';
  import { rowHeight, rowOver } from './thumb-size';
  import { boxRow, canvasFloor, oneRowTop, panelByLayers, phoneLayout, phoneTools, pickStep, railLiesFor, sheetScrollsWhole, toolRoom, yieldToCanvas, type LayoutStep, type TopCut } from './small-screen';
  import { pickerAccept } from './file-accept';
  import type { DraftEntry } from '../draft/restore';
  import type { ToonDocument } from '../format/types';
  import { dateLocale, t } from '../i18n';
  import { budgetLabel } from './format-limit';

  // Optional publish hook. When a host app provides it, a Publish button appears
  // and hands the host a plain snapshot of the current document; the editor
  // itself stays unaware of what publishing means (no network, no platform
  // coupling).
  // The soundtrack travels beside the document, not inside it: the toon format
  // holds drawings, and the platform stores the file on its own endpoint.
  // `sent` is the host's word back that the drawing went out: its draft on this
  // device goes then — the editor cannot know that, the host cannot reach the draft.
  // `stageNote` is the host's own word over the canvas — the site's first-run
  // hint. The stage is the only box that knows where the canvas is, so the
  // note is placed against it rather than against the whole editor. It is told
  // whether a line is drawn, and is drawn until the toon has a second frame:
  // the hint's «then add a frame» left with the first stroke, when it was next.
  // `startNew` is the host asking for a new drawing outright (the site's
  // «Новый мульт» tile): the studio opens on the choice of a sheet, past the
  // drafts and whatever the start-up setting says.
  // `open` is the host handing over a drawing to continue (a draft kept on
  // the account): the studio starts on it, as on a file just opened.
  let {
    onPublish,
    stageNote,
    named,
    home,
    startNew,
    open,
  }: {
    onPublish?: (doc: ToonDocument, audio?: AudioTrackData | null, sent?: () => Promise<void>) => void;
    stageNote?: Snippet<[drawn: boolean, frames: number, playing: boolean]>;
    /** A first visit: a phone's row of keys wears its names until the host takes this back. */
    named?: boolean;
    /** The host's way back to its own pages, for where it has put its header away (a phone lying down): a key behind «⋯». */
    home?: { href: string; label: string };
    startNew?: boolean;
    open?: { doc: ToonDocument; audio?: AudioTrackData | null };
  } = $props();
  /** Once: the hub opened by hand later starts on the drafts as ever. */
  let createOnOpen = $state(untrack(() => startNew === true));

  const editor = new EditorState();
  // The session being autosaved. Minted when the editor opens and kept for as
  // long as this sheet lives, so a visit overwrites its own record instead of
  // piling up a new draft per stroke (reference `autosave_worker.js:14-22`); a
  // draft opened from the list continues under its own id, and opening a file
  // starts a fresh one. Nothing is written until something is drawn.
  let draftId = $state(newDraftId());

  // Root element, so F can request fullscreen on the whole editor.
  let editorEl: HTMLDivElement;
  let audioOpen = $state(false);
  let audioKey = $state<HTMLButtonElement | undefined>();
  // Components the keyboard drives: Space is play/stop, Alt+S the export.
  let playControls = $state<PlayControls | undefined>();
  let exportButton = $state<ExportSheet | undefined>();

  // The two sheets the editor draws itself. `showModal()` is what makes them
  // modal in fact and not only in the accessibility tree; `onclose` puts the
  // flag back, so Esc and the close buttons end at the same place.
  /** The drafts hub, when it is up: `close()` is its way out. */
  let hub = $state<DraftsHub | undefined>();
  /** The hub was called up over the studio, and from which key: it gets the focus back. */
  let hubFromStudio = false;
  let hubFrom: Element | null = null;
  /** A sheet is up: a modal one, or the hub standing in place of the studio. */
  const SHEET_UP = 'dialog:modal, dialog.hub[open]';
  let manualDialog = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    manualDialog?.showModal();
  });
  // The studio's own question, note and name — where the browser's confirm(),
  // alert() and prompt() stood (critique 2026-10-06): its chrome and its «OK»
  // at the very moments a drawing is at stake. One at a time; a new one
  // answers the old with a no.
  let question = $state<{ kind: 'ask' | 'tell' | 'text'; message: string; yes: string; value: string; final: boolean; done: (yes: boolean) => void } | null>(null);
  let questionDialog = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    questionDialog?.showModal();
  });
  function put(kind: 'ask' | 'tell' | 'text', message: string, yes: string, value = '', final = false): Promise<boolean> {
    question?.done(false);
    return new Promise((done) => (question = { kind, message, yes, value, final, done }));
  }
  /** What the name field held when it was answered: the question is gone by then. */
  let typed = '';
  function answer(yes: boolean): void {
    const asked = question;
    typed = asked?.value ?? '';
    question = null;
    asked?.done(yes);
  }
  // `final`: the yes cannot be taken back (drafts, palettes, the track, a
  // plugin) — the sheet then opens on «Отмена», as the plugin warning does: a
  // second Enter on «Удалить все» took every drawing on the device.
  const ask = (message: string, yes = t('ask.yes'), final = false): Promise<boolean> => put('ask', message, yes, '', final);
  const tell = async (message: string): Promise<void> => void (await put('tell', message, t('ask.ok')));
  const askText = async (message: string, value: string): Promise<string | null> =>
    (await put('text', message, t('ask.save'), value)) ? typed : null;
  // The mega-eraser warning: a dialog, not alert(), so it can carry
  // «Больше не показывать» — a reload used to bring the alert back for good.
  let megaWarnOpen = $state(false);
  let megaWarnDialog = $state<HTMLDialogElement | undefined>();
  /** The draft written as the tool was picked actually reached storage. */
  let megaDraftSaved = $state(false);
  $effect(() => {
    megaWarnDialog?.showModal();
  });

  /** Mirrors `document.fullscreenElement`, so the button can show it is on. */
  let isFullscreen = $state(false);

  function toggleFullscreen(): void {
    if (!document.fullscreenEnabled) {
      return;
    }
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : editorEl.requestFullscreen();
    void request.catch(() => {});
  }

  /**
   * A phone's browser keeps its bars and the site its header over a sheet that
   * has little room as it is (owner, 2026-10-08): the first touch on the studio
   * takes the whole screen. Once a visit — whoever leaves the mode has said so
   * — and only for a finger on a phone-size studio: a narrow window under a
   * mouse is not a phone. On release: a touch gives the browser its leave to
   * go full screen as it lifts, not as it lands. Where there is no full screen
   * (an iPhone) nothing happens.
   */
  let wentFull = false;
  function fullOnFirstTouch(e: PointerEvent): void {
    if (wentFull || !compact || e.pointerType !== 'touch') return;
    wentFull = true;
    if (document.fullscreenEnabled && !document.fullscreenElement) void editorEl.requestFullscreen().catch(() => {});
  }

  /**
   * Alt+L, the reference's own debug hatch (`bundle:11407-11409`): whatever
   * the session logged as an error, as a file. Nothing leaves the machine.
   */
  function downloadErrorLog(): void {
    const lines = editor.errorLog.length > 0 ? editor.errorLog : [new Date().toISOString()];
    saveFile(new Blob([lines.join('\n')], { type: 'text/plain' }), 'toonop-errors.txt');
  }

  // --- Bottom panel divider ------------------------------------------------
  // Alt+E and F are tools only while their keys are on the panels: put the
  // feather back in a preset that started without it and F picks it up, take
  // it away and F is fullscreen again. The quick palette (a preset's own
  // behaviour) still decides whether M opens the picker (Multator) or merges
  // the buffer (Toonio/Toonop).
  const hasMegaEraser = $derived(editor.availableTools.includes('mega-eraser'));
  const hasFeather = $derived(editor.availableTools.includes('feather'));
  const quickPalette = $derived(editor.ux.quickPalette !== null);
  /** A shell key's hover label, as the frame menu names it (owner, 17th audit). */
  const menuKey = (action: FrameMenuAction) => frameMenuKey(action, editor.settings.letterKeys, quickPalette);
  /** The pipette's source pair is on the panel always, live only under the pipette. */
  const pipetteUp = $derived(editor.tool === 'pipette');
  /** Toonio keeps a project file behind Alt+S; the others export instead. */
  const hasProjectFile = $derived(editor.ux.projectFile);

  // The studio bar is resizable from its top edge, and the timeline is the row
  // that grows with it — dragging down gives the grid more layers and frames.
  let viewportHeight = $state(0);
  let viewportWidth = $state(0);
  /**
   * The floor grows with a soundtrack: the strip and the wave lane are part of
   * the timeline, so a panel sitting at its minimum has to make room for them
   * rather than push the layer rows out of view.
   */
  const readFont = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let rootFont = $state(readFont());
  /** A finger is the pointer here. */
  const touch = matchMedia('(pointer: coarse)').matches;
  // No cursor to hover with — a tablet, which is laid out as the desktop: a key
  // there has no tooltip to name it, so a first visit names the few it starts
  // with, as a phone does (owner, 2026-10-08).
  const noHover = matchMedia('(hover: none)').matches;
  let boxW = $state(0);
  let boxH = $state(0);
  /** Standing up. */
  const tall = $derived(boxH >= boxW);
  let step = $state<LayoutStep>('full');
  /** A phone: toonop's desktop, its bar over the canvas cut to one row (small-screen.ts). */
  const compact = $derived(step !== 'full');
  const cut = $derived(
    compact
      ? phoneLayout(editor.panels, presetPanels(DEFAULT_PRESET), {
          tools: phoneTools(editor.ux),
          tall,
          // «Отправить», «⋯» and the colour; lying down, undo and redo and the
          // transport's six too: a frame, back, play, on, the onion skin, the sound.
          room: toolRoom(boxW, rootFont, { publish: !!onPublish, keys: tall ? 2 : 10 }),
          // The hand is a cursor's tool: two fingers move the sheet (owner, 2026-10-07).
          drawn: (tool) => (tool !== 'pipette' || editor.pipetteOffered) && !(tool === 'drag' && touch),
        })
      : null,
  );
  /** The arrangement as drawn: the user's own, or a phone's cut of toonop's. */
  /**
   * The desktop's bar over the canvas stays one row (small-screen.ts,
   * `oneRowTop`): what the whole row and the row with its tools behind a key
   * need, px — measured off the row as drawn, so the cut is picked by the
   * width alone, with no wrap to detect and nothing to flicker on the way back.
   */
  let topNeed = $state<[number, number]>([0, 0]);
  let topEl = $state<HTMLElement | undefined>();
  const topCut = $derived<TopCut>(compact || editor.arranging || boxW >= topNeed[0] ? 0 : boxW >= topNeed[1] ? 1 : 2);
  /** Escape on the key that opened the sound plate closes it: opened by a click, the focus is still here, not in the plate. */
  function escAudio(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !audioOpen) return;
    e.stopPropagation();
    audioOpen = false;
  }
  /** Enter and Escape give the keys back: left in the frame-rate field, E, A and Space went on typing into it. */
  function leaveField(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
  }
  /** What is cut out of the arrangement: a phone's, or the desktop's one row. */
  const over = $derived(cut ?? oneRowTop(editor.panels, topCut, { tools: phoneTools(editor.ux) }));
  const panels = $derived(over?.panels ?? editor.panels);
  // Another arrangement, another text size: both rows are measured anew.
  const topKey = $derived(`${editor.panels.top.join()}|${rootFont}|${!!onPublish}`);
  $effect(() => {
    void topKey;
    untrack(() => (topNeed = [0, 0]));
  });
  $effect(() => {
    void panels.top;
    void topKey;
    const row = topEl;
    if (!row || compact || editor.arranging || topCut === 2) return;
    const level = topCut;
    // A key in a wrapper (`display: contents`: a tool that opens its brush) has no box of its own.
    const boxOf = (kid: Element): HTMLElement | null => ((kid as HTMLElement).offsetWidth > 0 ? (kid as HTMLElement) : (kid.firstElementChild as HTMLElement | null));
    const measure = (): void => {
      const style = getComputedStyle(row);
      // The save status is a note out of the flow, and the first-visit note
      // takes a line of its own: neither is the row's need. Counted, the
      // note folded a wide desk into the phone's row at the first autosave.
      const kids = [...row.children].filter((kid) => !kid.matches('.saved, .top-note'));
      const need = Math.ceil(
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
          (parseFloat(style.columnGap) || 0) * Math.max(0, kids.length - 1) +
          kids.reduce((sum, kid) => sum + (kid.classList.contains('spring') ? 0 : (boxOf(kid)?.offsetWidth ?? 0)), 0),
      );
      if (topNeed[level] !== need) topNeed = level === 0 ? [need, topNeed[1]] : [topNeed[0], need];
    };
    untrack(measure);
    // What is in the row grows under it — a key that comes late, a name that
    // changes — and the row measured once wrapped again (owner, 2026-10-07).
    if (typeof ResizeObserver === 'undefined') return;
    const sizes = new ResizeObserver(() => measure());
    for (const kid of row.children) {
      sizes.observe(kid);
      const inner = kid.firstElementChild;
      if (inner) sizes.observe(inner);
    }
    return () => sizes.disconnect();
  });
  /** Each bottom row's content box — padding out, so a row's bleed is not a wrap. */
  let rowBoxes = $state<(DOMRectReadOnly | undefined)[]>([]);
  // A row that went leaves its box behind: the palette's 239px, counted again
  // under the next row made at that index, took the studio to the phone's
  // layout in the middle of arranging — and with no bar drawn, for good.
  $effect(() => {
    const rows = panels.rows.length;
    if (untrack(() => rowBoxes.length) > rows) rowBoxes.length = rows;
  });
  /** One key tall: what the floor's arithmetic expects of a row of keys. */
  const KEY_ROW = 44;
  /**
   * The root text size over the 16px the floor's numbers were measured at. The
   * keys and the strip head are in rem, so at 200 % text a floor in fixed px
   * left the layer row under the panel's edge. Watched on a one-rem probe,
   * not read on a window resize: a text-only zoom resizes no window, and the
   * step then kept 100 %'s sum — a tablet at 200 % had a canvas 42 px wide.
   */
  let remProbe = $state<HTMLElement>();
  const readRootFont = () => (rootFont = readFont());
  $effect(() => {
    if (!remProbe) return;
    readRootFont();
    const watch = new ResizeObserver(readRootFont);
    watch.observe(remProbe);
    return () => watch.disconnect();
  });
  const textScale = $derived(rootFont / 16);
  /**
   * What wrapped key rows take beyond one key each. Between a phone and a wide
   * desktop the transport does not fit one line and wraps; the floor has to
   * hear about it, or the second line comes out of the strip and the layer
   * rows go under the panel's edge. The strip's own row grows with the panel.
   */
  const wrapExtra = $derived(
    panels.rows.reduce(
      (sum, row, i) => (row.includes('timeline') || boxRow(row) ? sum : sum + Math.max(0, (rowBoxes[i]?.height ?? 0) - KEY_ROW * textScale)),
      0,
    ),
  );
  /**
   * What a row with a box in it (the palette, the brush) takes beyond one key.
   * The bar is drawn that much taller where the canvas can spare it, but the
   * floor below does not hear of it: the step is picked by the floor, and a
   * box dropped into a row took a laptop to the phone's layout.
   */
  const boxExtra = $derived(
    Math.round(panels.rows.reduce(
      (sum, row, i) => (!row.includes('timeline') && boxRow(row) ? sum + Math.max(0, (rowBoxes[i]?.height ?? 0) - KEY_ROW * textScale) : sum),
      0,
    )),
  );
  const floorOf = (rows: number, wrap: number): number =>
    Math.round(
      (PANEL_HEIGHT_MIN
        + (editor.audio.hasTrack ? PANEL_HEIGHT_AUDIO : 0)
        // The floor is written for a strip and one row; every row beyond that
        // needs its own height, or it is cut off at the panel's edge.
        + Math.max(0, rows - 2) * PANEL_ROW_STEP) * textScale
        + wrap
        + rowOver(editor.doc),
    );
  const panelFloor = $derived(floorOf(panels.rows.length, wrapExtra));
  /**
   * What the user's own rows wrapped by when the desktop last drew them: a
   * phone draws other rows, and the step is picked by the user's.
   */
  let fullWrap = 0;
  /** Keyboard step for the divider, in px (WCAG 2.2 AA 2.5.7 — no drag required). */
  const PANEL_STEP = 22;
  /**
   * The drag in progress on any of the three dividers. `sign` is which way the
   * pointer has to travel for the panel to grow: the bottom bar and the column
   * on the right grow as the pointer comes back towards the canvas.
   */
  let resize = $state<
    | {
        pointerId: number;
        from: number;
        size: number;
        sign: number;
        axis: 'x' | 'y';
        side: SideId | 'panel' | null;
        apply: (px: number, persist?: boolean) => void;
        /** The most the canvas leaves it: the hand stops there, and so does what is stored. */
        max: number;
        /** The size drawn by the last move, stored on the release. */
        px?: number;
      }
    | null
  >(null);

  function startResize(
    e: PointerEvent,
    axis: 'x' | 'y',
    sign: number,
    size: number,
    apply: (px: number, persist?: boolean) => void,
    side: SideId | 'panel' | null = null,
    max = Infinity,
  ): void {
    // Only the main button: a right press opened the context menu, which
    // swallowed the release, and the column followed the bare hover.
    if (!e.isPrimary || e.button !== 0) return;
    resize = { pointerId: e.pointerId, from: axis === 'y' ? e.clientY : e.clientX, size, sign, axis, side, apply, max };
  }

  function onDividerMove(e: PointerEvent): void {
    if (!resize || e.pointerId !== resize.pointerId) return;
    // A mouse or pen moving with nothing pressed let go where its release never came.
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      onDividerUp(e);
      return;
    }
    const now = resize.axis === 'y' ? e.clientY : e.clientX;
    // Drawn at once, stored on the release: the whole UI config went to
    // storage on every pointer sample.
    resize.px = Math.min(resize.max, resize.size + (now - resize.from) * resize.sign);
    resize.apply(resize.px, false);
  }

  function onDividerUp(e: PointerEvent): void {
    if (!resize || e.pointerId !== resize.pointerId) return;
    // What the last move drew — a cancel carries no place of its own; a tap
    // on the edge moved nothing and writes nothing.
    if (resize.px !== undefined) resize.apply(resize.px);
    resize = null;
  }

  function onDividerKey(e: KeyboardEvent): void {
    // With a modifier the arrow is the browser's (Alt+↑) or the sheet's pan.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        editor.setPanelHeight(Math.min(panelMax, panelHeight + PANEL_STEP));
        break;
      case 'ArrowDown':
        e.preventDefault();
        editor.setPanelHeight(panelHeight - PANEL_STEP);
        break;
    }
  }

  // --- Side columns --------------------------------------------------------
  // Both side columns resize from their inner edge and fold away to a strip
  // with an arrow on it. Which edge that is depends on the alternative layout,
  // where the two columns swap places.
  /** What each column measures now, so an undragged one starts from its own width. */
  const sidePx = $state({ left: 0, right: 0 });
  /** A column as drawn: a profile's fixed sidebar is open at its own width (ux-profile.ts). */
  const side = (id: SideId) => sideAsDrawn(editor.ux, id, editor.sides[id]);
  /** A fixed sidebar's width, rem: one key and its padding (`.studio .left.sidebar`). */
  const SIDEBAR_REM = 3.95;
  /** No seam and no fold tab on it. */
  const sideFixed = (id: SideId): boolean => id === 'left' && (compact || !!editor.ux.leftFixed);
  /** How tall each column's card is: its seam is no taller. */
  const sideH = $state({ left: 0, right: 0 });
  /** Keyboard step for a column divider, in px (WCAG 2.2 AA 2.5.7). */
  const SIDE_STEP = 16;
  /** Whether the column is the one on the screen's left, after the alt swap. */
  const atLeft = (id: SideId): boolean => (id === 'left') !== editor.settings.altLayout;
  // --- Small screens (small-screen.ts) -------------------------------------
  // The step is a sum: what the canvas would keep beside the columns and over
  // the bar, measured from the editor's own box — which the layout inside it
  // does not change, so the sum cannot chase its own tail.
  /** The bottom bar as drawn: the table runs on under it (`--stage-under`). */
  let panelBoxH = $state(0);
  /** The stage as drawn: under 44rem the canvas's hint rises over the zoom window's row. */
  let stageWidth = $state(0);
  let stageHeight = $state(0);

  /** One rem now: the columns are in rem, twice as wide at 200 % text. */
  const rem = $derived(16 * textScale);
  /** Whether the profile draws any of these items where they lie. */
  function draws(ids: readonly string[]): boolean {
    void editor.pluginsVersion;
    return columnDraws(ids, {
      pipette: editor.pipetteOffered,
      publish: !!onPublish,
      fullscreen: document.fullscreenEnabled,
    });
  }
  /** Whether the column has an item the profile draws: one of undrawn ones stood as an empty strip. */
  function sideDraws(id: SideId): boolean {
    return draws(panels[id]);
  }
  /** The columns' default widths, in rem (the `.left` and `.right` rules below). */
  const SIDE_REM: Record<SideId, number> = { left: 8.4, right: 15.9 };
  /**
   * A column's floor in the full layout: its rem default — or the narrower
   * width it was dragged to — or its strip. Not the width it was dragged out
   * to: the step is picked from this, and a column pulled to 480px on a
   * 1024px screen took the studio to the phone's layout, with no edge to
   * drag back (owner, 21st audit).
   */
  function sideBase(id: SideId): number {
    if (!sideDraws(id)) return 0;
    if (sideFixed(id)) return (SIDEBAR_REM + SIDE_GAP) * rem;
    // Folded, a column is its tab alone, over the canvas.
    if (side(id).collapsed) return 0;
    // Open, the column is a card with the table at its outer edge (`SIDE_GAP`).
    return Math.min(side(id).width ?? SIDE_REM[id] * rem, SIDE_REM[id] * rem) + SIDE_GAP * rem;
  }
  /** The same floor for the user's own arrangement, whatever is drawn now: the step is picked by it. */
  function fullBase(id: SideId): number {
    if (!draws(editor.panels[id])) return 0;
    if (id === 'left' && editor.ux.leftFixed) return (SIDEBAR_REM + SIDE_GAP) * rem;
    if (side(id).collapsed) return 0;
    return Math.min(side(id).width ?? SIDE_REM[id] * rem, SIDE_REM[id] * rem) + SIDE_GAP * rem;
  }
  /** The table between a card — a column, the bottom bar — and the studio's edge, rem (`.studio .left`). */
  const SIDE_GAP = 0.6;
  /**
   * The fixed sidebar is a widget of its own (owner, 2026-10-07): it lies —
   * one line along the stage's foot, in the middle, in no column — or stands
   * at the edge, whichever leaves the sheet bigger (`railLiesFor`): a wide
   * sheet on a screen standing up wants the width, an upright one the height.
   */
  const railLies = $derived(sideFixed('left') && !editor.arranging && railLiesFor(
    { w: boxW, h: stageHeight },
    { width: editor.doc.width, height: editor.doc.height },
    // Its column (the card and the table at its edge); its line (a key, the card's padding, the table under it).
    // On a phone the standing widget takes no column: the sheet lies under it.
    { side: compact ? 0 : (SIDEBAR_REM + SIDE_GAP) * rem, foot: (compact ? 44 : 2.75 * rem) + 1.4 * rem },
    tall,
  ));
  /**
   * What a column takes of the studio's width as drawn — the canvas runs on
   * under it by this much (`--stage-left`, `--stage-right`).
   */
  function sideTrack(id: SideId): number {
    if (id === 'left' && railLies) return 0;
    if (!(sideDraws(id) || editor.arranging)) return 0;
    return sidePx[id] + (folded(id) ? 0 : SIDE_GAP * rem);
  }
  const sideAt = (left: boolean): SideId => (atLeft('left') === left ? 'left' : 'right');
  /** The canvas's floor: what the bar and the columns, however stretched, leave it. */
  const stageFloor = $derived(canvasFloor({ w: viewportWidth || boxW, h: viewportHeight || boxH }));
  /** What the canvas's floor leaves the bar; anything, until the editor is measured. */
  const panelRoom = $derived(boxH ? Math.floor(boxH - stageFloor.h - 1.2 * rem) : Infinity);
  /** The least the bar is drawn at: its floor, and its boxes where the canvas spares the room. */
  const panelLow = $derived(yieldToCanvas(panelFloor + boxExtra, panelFloor, panelRoom));
  /** The most the divider gives it: three quarters of the viewport, less where the canvas needs it. */
  const panelMax = $derived(Math.max(panelLow, Math.min(Math.round((viewportHeight || 800) * 0.75), panelRoom)));
  /** The stored panel height as drawn — stored whole, for a bigger screen. */
  const panelHeight = $derived(yieldToCanvas(editor.panelHeight ?? panelByLayers(panelLow, editor.doc.layers.length, rowHeight(editor.doc)), panelLow, panelMax));
  /**
   * What the canvas's floor leaves a column. The left one is asked first; the
   * right one takes what the left one, as drawn, has left.
   */
  function sideRoom(id: SideId): number {
    if (!boxW) return Infinity;
    // Whole px: the width is spoken by the divider as its value.
    return Math.floor(boxW - stageFloor.w - (id === 'left' ? sideBase('right') : folded('left') || !sideDraws('left') ? sideBase('left') : sideWidth('left')));
  }
  /** The most a column's edge gives it. */
  const sideMax = (id: SideId): number => Math.floor(Math.max(sideFloor(id), Math.min(SIDE_WIDTH_MAX, sideRoom(id))));
  /** An open column's floor: `sideBase` without the fold. */
  const sideFloor = (id: SideId): number => sideFixed(id) ? SIDEBAR_REM * rem : Math.min(side(id).width ?? SIDE_REM[id] * rem, SIDE_REM[id] * rem);
  $effect(() => {
    if (!boxW || !boxH) return;
    // The step is picked by the user's own arrangement, as the desktop would
    // draw it — a phone draws toonop's, and must not be judged by that.
    const was = untrack(() => step);
    if (was === 'full') fullWrap = wrapExtra;
    // Open, the bar is a card with the table around it: 0.6rem over and under (`.studio .panel`).
    const bar = editor.panels.rows.length === 0 || editor.panelCollapsed ? 0 : floorOf(editor.panels.rows.length, fullWrap) + 1.2 * rem;
    // The top bar is one line of keys in its padding (`.studio .top`).
    const top = draws(editor.panels.top) ? 3.75 * rem : 0;
    const full = { w: boxW - fullBase('left') - fullBase('right'), h: boxH - bar - top };
    const view = { w: viewportWidth || boxW, h: viewportHeight || boxH };
    step = pickStep(was, full, view);
  });
  /**
   * The zoom window stands under the column on the screen's left, at the
   * studio's own edge (owner, 2026-10-06: there is room there now) — while
   * that column is open and short enough to leave the window its corner. The
   * sidebar stands in the middle of the stage's height, so the corner is what
   * is left under it: half of the rest.
   */
  const scaleUnder = $derived.by((): SideId | null => {
    if (railLies) return null;
    const id = sideAt(true);
    return sideDraws(id) && !folded(id) && sideH[id] + (sideFixed(id) ? 2 : 1) * (SIDE_GAP + 5.5) * rem <= stageHeight ? id : null;
  });
  // A phone's arrangement is not the user's to rearrange: the arranger is
  // for the one the desktop draws.
  $effect(() => {
    if (compact && editor.arranging) editor.arranging = false;
    // Its key is a handle there, and the arranger's plate lay over its ×.
    if (editor.arranging) audioOpen = false;
  });

  /** «⋯» on a phone: the window with the keys its one row has no room for. */
  let moreOpen = $state(false);
  $effect(() => {
    if (!panels.top.includes('more')) moreOpen = false;
  });
  let moreKey = $state<HTMLButtonElement | undefined>();
  let tabWindow = $state<HTMLElement | undefined>();
  /** The strip under a phone's transport, folded: lying down, or short (200 % text), until asked for. */
  let stripShut = $state<boolean | null>(null);
  const stripFolded = $derived(compact && (stripShut ?? (!tall || boxH < 30 * rem)));
  /** A phone lying down with its strip folded: the transport is in the row over the canvas, the bar is its tab alone. */
  const barBare = $derived(compact && !tall && stripFolded);
  const FOCUSABLE =
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

  /**
   * The tool windows and the zoom window share the floating windows' stack:
   * pressed, they come over them, on the top rung (FloatWindow steps down).
   */
  const raiseTools = (): void => {
    editor.toolsOnTop = true;
  };

  /** A key the focus can go to: shown, not inert, in the Tab order. */
  const usableKey = (el: HTMLElement) =>
    el.matches(FOCUSABLE) && el.getAttribute('tabindex') !== '-1' && !el.closest('[inert]') && el.getClientRects().length > 0;

  // The «⋯» window goes with the small screen (a phone turned, the text made
  // smaller), and the focus in it fell to <body>. It goes to the same control
  // in the desktop's columns, else to the first key there is. Before the DOM
  // changes, while the window and its focus are still there.
  $effect.pre(() => {
    if (compact) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !untrack(() => tabWindow)?.contains(active)) return;
    const twin = twinSelector(active);
    void tick().then(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const found = [...editorEl.querySelectorAll<HTMLElement>(twin ?? FOCUSABLE)].find(usableKey);
      (found ?? [...editorEl.querySelectorAll<HTMLElement>(FOCUSABLE)].find(usableKey))?.focus();
    });
  });

  /**
   * A key that switches itself off as it is pressed — «Сохранить» once saved,
   * ⏮ on the first frame, «Отменить» on the last step — took the focus with
   * it: Chrome drops it on <body>, and a reader lost the place. It goes to the
   * next key that still works, as Tab would. The sheets give focus back by
   * themselves, so a key in a <dialog> is left to them.
   */
  async function passFocusOnDisable(e: MouseEvent): Promise<void> {
    const key = e.target instanceof Element ? e.target.closest('button') : null;
    if (!key || key.closest('dialog')) return;
    // Safari's mouse click focuses no button: there is nothing to pass.
    const held = document.activeElement === key;
    // A task, not a tick: the capture runs before the key's own handler, and
    // the page's microtasks run between the two.
    await new Promise((done) => setTimeout(done));
    // Chrome moves the focus to <body> with its next frame, which may have
    // been drawn before this task: the focus was then left where it fell.
    const at = document.activeElement;
    if (!held || !key.disabled || (at !== key && at !== document.body)) return;
    const all = [...editorEl.querySelectorAll<HTMLElement>('button, input, select, [tabindex]')];
    focusHeir(all, key, usableKey)?.focus();
  }

  /** Opens the «⋯» window or, pressed again, closes it. */
  async function toggleMore(): Promise<void> {
    if (moreOpen) {
      closeMore();
      return;
    }
    moreOpen = true;
    await tick();
    (tabWindow?.querySelector<HTMLElement>(FOCUSABLE) ?? tabWindow)?.focus();
  }

  /** Closes the window; the focus goes back to its key, not to the page. */
  function closeMore(): void {
    moreOpen = false;
    moreKey?.focus();
  }

  // On a phone a press anywhere else closes what is open — «⋯», the sound's
  // sheet — as it closes a key's box (PopKey): three of them stood open at
  // once (owner, 2026-10-07). The press still does its own work — a key is
  // pressed, a stroke starts — but a tap on the sheet only closes (owner,
  // 2026-10-08: it left a dot); the sheet is told of it (dismiss-press.ts). A
  // sheet the sound's plate asked from (a question) is not «elsewhere».
  $effect(() => {
    if (!moreOpen && !(compact && audioOpen)) return;
    const away = (e: PointerEvent) => {
      const hit = e.target instanceof Element ? e.target : null;
      if (!hit) return;
      if (moreOpen && !tabWindow?.contains(hit) && !moreKey?.contains(hit)) {
        moreOpen = false;
        notePopupClosed(e);
      }
      if (compact && audioOpen && !hit.closest('.audio-plate, dialog') && !audioKey?.contains(hit)) {
        audioOpen = false;
        notePopupClosed(e);
      }
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });

  /**
   * A key in the window that opens a sheet (export, the settings, the manual,
   * the drafts) shuts the window first: it stood open under the sheet it had
   * opened. In the capture, before the key's own press — the focus is on «⋯»
   * by then, and the sheet gives it back there, not to a key that is gone.
   */
  function shutMoreForSheet(e: MouseEvent): void {
    if ((e.target as Element | null)?.closest('[aria-haspopup="dialog"]')) closeMore();
  }

  /** Esc closes the window — unless a control inside took it first (a menu, a field). */
  function onMoreKey(e: KeyboardEvent): void {
    if (moreOpen && e.key === 'Escape' && !e.defaultPrevented && !composing(e)) {
      e.preventDefault();
      e.stopPropagation();
      closeMore();
    }
  }

  /**
   * Folded away — but never on a small screen, where there are no columns to
   * fold. A fold made on a desktop must not leave the tools unreachable there.
   */
  const folded = (id: SideId): boolean => side(id).collapsed && !compact;
  /** The bottom bar, folded away by the same rule. */
  const panelFolded = $derived(editor.panelCollapsed && !compact);
  /** What the bar's fold key says: the whole bar on the desktop, the strip on a phone. */
  const barFolded = $derived(panelFolded || stripFolded);
  /**
   * The transport's key is on screen.
   * The preview's loop lives in that key: with the bar folded, or the
   * transport put away, Space pressed nothing — so a hidden one stands in.
   */
  const transportDrawn = $derived(
    itemDrawn(panels, 'transport', { left: folded('left'), right: folded('right'), rows: panelFolded }),
  );
  /** The stage's own thickness rail: not where a panel already draws the slider (panels.ts). */
  const stageRail = $derived(
    stageRailShown(panels, { left: folded('left'), right: folded('right'), rows: panelFolded }),
  );
  /** An open column's width as drawn: the stored one, giving way to the canvas; unstored, as measured. */
  const sideWidth = (id: SideId): number => {
    const stored = side(id).width;
    return stored ? yieldToCanvas(stored, sideFloor(id), sideRoom(id)) : sidePx[id];
  };
  /** A folded column is sized by its strip rule, not by the width it remembers. */
  const sideStyle = (id: SideId): string | undefined =>
    !folded(id) && side(id).width ? `width: ${sideWidth(id)}px` : undefined;
  /** Collapse points away from the canvas, expand points back towards it. */
  const foldIcon = (id: SideId, collapsed: boolean): 'chevron-left' | 'chevron-right' =>
    atLeft(id) === collapsed ? 'chevron-right' : 'chevron-left';

  function onSideDown(e: PointerEvent, id: SideId): void {
    startResize(e, 'x', atLeft(id) ? 1 : -1, sideWidth(id), (px, persist) => editor.setSideWidth(id, px, persist), id, sideMax(id));
  }

  function onSideKey(e: KeyboardEvent, id: SideId): void {
    // Alt+← is «back», Ctrl+Shift+arrows pan the sheet: neither is a resize.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const step = e.key === 'ArrowRight' ? SIDE_STEP : e.key === 'ArrowLeft' ? -SIDE_STEP : 0;
    if (!step) return;
    e.preventDefault();
    editor.setSideWidth(id, Math.min(sideMax(id), sideWidth(id) + step * (atLeft(id) ? 1 : -1)));
  }

  /** Arrow keys: Shift grows the timeline selection, a bare arrow moves the active cell. */
  function moveOrExtend(shift: boolean, dFrame: number, dLayer: number): void {
    const active = { frame: editor.activeFrame, layer: editor.activeLayer };
    if (shift) {
      // Each press moves the block's far edge; the active cell is the anchor.
      const to = extendTarget(editor.selection, active, dFrame, dLayer, editor.cellBounds);
      editor.selectCell(to.frame, to.layer, 'range');
      return;
    }
    editor.selectFrame(wrapIndex(active.frame + dFrame, lastFrame + 1));
    editor.selectLayer(wrapIndex(active.layer + dLayer, editor.doc.layers.length));
  }

  // Editor hotkeys, matching the reference editors: bare single keys, ignored
  // while typing in a form field or when a browser/OS modifier is held.
  /** Whether the focused key was clicked or reached by Tab (key-owner.ts). */
  const focusFrom = focusOrigin();

  function onKeydown(e: KeyboardEvent): void {
    focusFrom.key(e.key);
    // An update is downloading: the editor is not there to be typed at. Its
    // Ctrl+S is still not the browser's «save page».
    if (editor.updating) {
      if ((e.ctrlKey || e.metaKey) && latinKey(e).toLowerCase() === 's') {
        e.preventDefault();
      }
      return;
    }
    // An input method is composing: its Enter picks a character, its Esc drops
    // the composition. Neither is the studio's — an Enter in a layer name
    // applied the live transform, an Esc closed the tab window around the field.
    if (composing(e)) {
      return;
    }
    // Read by place on a non-Latin layout: «и» is B (key-owner.ts).
    const key = latinKey(e);
    // An open sheet is where the hands are: Alt+E and Alt+S stacked the
    // mega-eraser warning and the export over it, three modals deep.
    const modalOpen = document.querySelector(SHEET_UP) !== null;
    // A small screen's window closes on Esc wherever the focus is — except
    // under a sheet, and in a live transform, whose Esc is the cancel.
    if (key === 'Escape' && moreOpen && !modalOpen && !editor.transform && !e.defaultPrevented) {
      e.preventDefault();
      closeMore();
      return;
    }
    // A text field keeps its Alt chords: Option+E is the accent key on a Mac,
    // AltGr+E, S and L type ę, ś and ł in Polish (key-owner.ts).
    if (e.altKey && typesText(e.target instanceof HTMLElement ? e.target : null)) {
      return;
    }
    // Alt+E is the reference's mega-eraser; every other modifier is the
    // browser's or the OS's.
    if (e.altKey && (key === 'e' || key === 'E') && hasMegaEraser) {
      e.preventDefault();
      // A held stroke or handle keeps its tool, as under the letter keys below.
      if (!e.repeat && !modalOpen && !editor.gestureHeld) {
        editor.selectTool('mega-eraser');
      }
      return;
    }
    // Reference Ctrl+S / Alt+S. These fire from a form field too: the browser
    // would otherwise take Ctrl+S for "save page". The reference's Alt+Enter,
    // which muted every question (`HotEnter`, toonio.bundle.js:320), is gone
    // on purpose: a drawing must not go by accident (owner, twelfth audit).
    if ((e.ctrlKey || e.metaKey) && (key === 's' || key === 'S')) {
      e.preventDefault();
      if (!e.repeat) {
        saveByHand();
      }
      return;
    }
    if (e.altKey && (key === 's' || key === 'S')) {
      e.preventDefault();
      if (e.repeat || modalOpen) {
        return;
      }
      // Reference Alt+S in Toonio saves the project to a file; the other
      // presets have no project file, so there it stays the export.
      if (hasProjectFile) {
        saveProjectFile();
      } else {
        exportButton?.start();
      }
      return;
    }
    // Reference Alt+L: the session's errors as a file, for a bug report.
    if (e.altKey && (key === 'l' || key === 'L')) {
      e.preventDefault();
      if (!e.repeat) {
        downloadErrorLog();
      }
      return;
    }
    if (e.altKey) {
      return;
    }
    // A stroke, an eraser pass or a dragged handle is under the hand: a frame
    // deleted, undone or switched now would pull its cell from under it.
    if (editor.gestureHeld) {
      return;
    }
    // The reference dispatches its hotkey table whatever modifier is held, so
    // Ctrl+Z, Ctrl+C, Ctrl+V and Ctrl+M land on the same handlers as the bare
    // keys; only A and F7 change meaning under Ctrl.
    // What the focused control, an open sheet or the letter-keys setting
    // keeps for itself never reaches the table (key-owner.ts).
    const owner = keyOwner({
      key,
      target: e.target instanceof HTMLElement ? e.target : null,
      defaultPrevented: e.defaultPrevented,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      modalOpen,
      letterKeys: editor.settings.letterKeys,
      byPointer: focusFrom.byPointer(e.target),
    });
    if (owner === 'control') {
      return;
    }
    // A held key runs on only where more of the same is the point (key-owner.ts):
    // a held Space, K or H flipped its toggle with every auto-repeat.
    if (e.repeat && !repeats(key)) {
      e.preventDefault();
      return;
    }
    // Ctrl+Shift+arrow slides a magnified sheet by a tenth of the table,
    // whatever the tool, a live transform included: it moves the view, not
    // the drawing (owner, after the fourteenth audit; key-owner.ts says why
    // not Shift+arrows).
    if (panSheetKey({ key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })) {
      e.preventDefault();
      editor.view = keyPan(editor.view, editor.stage, key);
      return;
    }
    // The hand takes the zoom and the arrows before frames and brush size do
    // — the reference's `helpTool.ArrowMove || PrevFrame` order.
    if (editor.tool === 'drag' && !editor.transform) {
      const step = e.shiftKey ? 30 : 10;
      let taken = true;
      switch (key) {
        case '+':
        case '=':
          editor.zoomBy(zoomDelta(editor.view.zoom, 1));
          break;
        case '-':
        case '_':
          editor.zoomBy(zoomDelta(editor.view.zoom, -1));
          break;
        case 'ArrowLeft':
          editor.panBy(step, 0);
          break;
        case 'ArrowRight':
          editor.panBy(-step, 0);
          break;
        case 'ArrowUp':
          editor.panBy(0, step);
          break;
        case 'ArrowDown':
          editor.panBy(0, -step);
          break;
        default:
          taken = false;
      }
      if (taken) {
        e.preventDefault();
        return;
      }
    }
    // An open transform owns the arrows, Q/W, +/- and Enter/Esc. Without one
    // those keys stay frame navigation and brush size, so this branch has to
    // come before the main switch.
    if (editor.transform) {
      let taken = true;
      switch (key) {
        // Reference: Space applies an unfinished transform instead of playing.
        case ' ':
        case 'Enter':
          editor.commitTransform();
          break;
        case 'Escape':
          editor.cancelTransform();
          break;
        case 'ArrowLeft':
          editor.nudgeTransform('move', -1, e.shiftKey, 'x');
          break;
        case 'ArrowRight':
          editor.nudgeTransform('move', 1, e.shiftKey, 'x');
          break;
        case 'ArrowUp':
          editor.nudgeTransform('move', -1, e.shiftKey, 'y');
          break;
        case 'ArrowDown':
          editor.nudgeTransform('move', 1, e.shiftKey, 'y');
          break;
        // Reference: Q and W turn the selection while it is live; outside a
        // transform Q is one of the two keys that pick the lasso up.
        case 'q':
        case 'Q':
          editor.nudgeTransform('rotate', -1, e.shiftKey);
          break;
        case 'w':
        case 'W':
          editor.nudgeTransform('rotate', 1, e.shiftKey);
          break;
        case '+':
        case '=':
          editor.nudgeTransform('scale', 1, e.shiftKey);
          break;
        case '-':
        case '_':
          editor.nudgeTransform('scale', -1, e.shiftKey);
          break;
        case 'h':
          editor.mirrorTransform('horizontal');
          break;
        case 'H':
          editor.mirrorTransform('vertical');
          break;
        // Z and Y walk the session's own steps. With none left they are
        // swallowed rather than falling through to the document's undo,
        // which would delete the strokes under the live frame.
        // Ctrl+Shift+Z is redo, as everywhere outside the reference;
        // bare Shift+Z stays undo.
        case 'Z':
          if (e.ctrlKey || e.metaKey) {
            editor.redoTransform();
          } else {
            editor.undoTransform();
          }
          break;
        case 'z':
          editor.undoTransform();
          break;
        case 'y':
        case 'Y':
          editor.redoTransform();
          break;
        default:
          taken = false;
      }
      if (taken) {
        e.preventDefault();
        return;
      }
    }

    let handled = true;
    switch (key) {
      case '+':
      case '=':
        editor.increaseBrushSize();
        break;
      case '-':
      case '_':
        editor.decreaseBrushSize();
        break;
      case 'b':
      case 'B':
        editor.selectTool('pencil');
        break;
      case 'e':
      case 'E':
        editor.selectTool('eraser');
        break;
      case 'p':
      case 'P':
        editor.selectTool('pipette');
        break;
      // Reference transform tools: D or O is the hand, Q or S the lasso,
      // `~` the distort. Unavailable under a preset that has no such button —
      // selectTool drops what the profile does not offer.
      case 'd':
      case 'D':
      case 'o':
      case 'O':
        editor.selectTool('drag');
        break;
      case 'q':
      case 'Q':
      case 's':
      case 'S':
        editor.selectTool('lasso');
        break;
      case '~':
      case '`':
        editor.selectTool('distort');
        break;
      // Reference Mirror: with nothing selected H flips the frame on every
      // selected layer.
      case 'h':
        editor.mirrorSelectedLayers('horizontal');
        break;
      case 'H':
        editor.mirrorSelectedLayers('vertical');
        break;
      // The clipboard is the timeline selection (cells × layers) — the strip
      // carries layers in every preset now.
      case 'c':
      case 'C':
        editor.copySelection();
        break;
      case 'v':
      case 'V':
        editor.pasteSelection();
        break;
      // Ctrl+Shift+Z is redo, as everywhere outside the reference; bare
      // Shift+Z stays undo there.
      case 'Z':
        if (e.ctrlKey || e.metaKey) {
          editor.redo();
        } else {
          editor.undo();
        }
        break;
      case 'z':
        editor.undo();
        break;
      // Redo also takes a bare key of its own, like every other shortcut here —
      // bare z/Z both mean undo, so shift alone cannot carry it.
      case 'y':
      case 'Y':
        editor.redo();
        break;
      // Reference M merges the buffer into the selected cells. Under Multator
      // it keeps its own meaning — M is the only way to its full colour picker.
      case 'm':
      case 'M':
        quickPalette ? editor.togglePalette() : editor.mergeSelection();
        break;
      // The reference's F is the feather where the preset has one; ours is
      // fullscreen, which otherwise stays on the button.
      case 'f':
      case 'F':
        if (hasFeather) {
          editor.selectTool('feather');
        } else {
          toggleFullscreen();
        }
        break;
      // Reference HotAdd / HotRemove: A adds a frame, Shift+A a layer;
      // Delete removes the frame, Shift+Delete the layer.
      // Reference HotAdd: A (and F7) add a frame after the current one, the
      // same key with Ctrl inserts one in front of it.
      case 'a':
      case 'F7':
        // Shift+F7 is the layer, as Shift+A: with the letters off the manual's
        // «F7 … Shift — слой» added a frame, and no key added a layer at all.
        if (e.shiftKey) {
          editor.addLayerAtActive(e.ctrlKey || e.metaKey);
        } else if (e.ctrlKey || e.metaKey) {
          editor.addFrameBeforeActive();
        } else {
          editor.addFrameAfterActive();
        }
        break;
      case 'A':
        editor.addLayerAtActive(e.ctrlKey || e.metaKey);
        break;
      // The frame once more, after itself (owner, 2026-10-08). Bare only:
      // Ctrl+G is the browser's.
      case 'g':
      case 'G':
        if (!e.ctrlKey && !e.metaKey) editor.duplicateActiveFrame();
        break;
      // Backspace is Delete's other name — the Mac's «delete» key sends it.
      case 'Delete':
      case 'Backspace':
        // The state asks «Удалить «Слой N»?» itself; a second question here
        // made Shift+Delete ask twice.
        if (e.shiftKey) {
          editor.removeActiveLayer();
        } else {
          editor.removeActiveFrame();
        }
        break;
      // Reference J / L and the arrows: frames sideways, layers up and down.
      case 'j':
      case 'J':
        editor.selectFrame(0);
        break;
      case 'l':
      case 'L':
        editor.selectFrame(lastFrame);
        break;
      // Shift extends the selection to the neighbor instead of walking the
      // active cell there — the keyboard equivalent of a Shift+click.
      case 'ArrowLeft':
        moveOrExtend(e.shiftKey, -1, 0);
        break;
      case 'ArrowRight':
        moveOrExtend(e.shiftKey, 1, 0);
        break;
      case 'ArrowUp':
        moveOrExtend(e.shiftKey, 0, 1);
        break;
      case 'ArrowDown':
        moveOrExtend(e.shiftKey, 0, -1);
        break;
      // Onion skin. The reference binds Tab; we do not — Tab is the way out
      // of the canvas for keyboard users (WCAG 2.1.2), so «калька» takes K.
      case 'k':
      case 'K':
        editor.toggleOnionSkin();
        break;
      // Reference: the X between the two swatches swaps outline and fill.
      // Under Ctrl it is the cut next to C and V (owner, after the twelfth audit).
      case 'x':
      case 'X':
        if (e.ctrlKey || e.metaKey) {
          editor.cutSelection();
        } else {
          editor.swapColors();
        }
        break;
      // Reference Space: run and stop the preview. Shift starts at the
      // active frame instead of the start of the range.
      case ' ':
        playControls?.toggle({ fromActive: e.shiftKey });
        break;
      // Esc ends every other mode here; the preview ran on under it.
      case 'Escape':
        if (editor.playing) {
          playControls?.toggle();
        } else {
          handled = false;
        }
        break;
      default: {
        // A plugin's key comes from its manifest, not from a case here: the
        // register already refused it if something above holds it.
        const added = plugins.toolByKey(key);
        if (added && !added.builtin) {
          editor.selectTool(added.id);
        } else {
          handled = false;
        }
      }
    }
    if (handled) {
      e.preventDefault();
    }
  }

  // Installed plugins come up from their cache, and only then does the
  // catalog get asked whether any of them has a newer version. Once, on
  // start: installing, removing and updating go through the plugins window.
  onMount(() => {
    void editor.startPlugins();
  });

  /** The lock over the editor while an update is downloading. */
  let updatingEl = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    if (editor.updating) {
      updatingEl?.showModal();
    } else {
      updatingEl?.close();
    }
  });

  /** Where the body of a tool's own window is put; the tool owns what is in it. */
  let pluginSlot = $state<HTMLDivElement | undefined>();
  $effect(() => {
    const window = editor.pluginWindow;
    if (pluginSlot && window) {
      pluginSlot.replaceChildren(window.el);
    }
  });

  /** Something has changed since the last write. The autosave clock clears it. */
  let dirty = $state(false);
  /**
   * The document the last write took. `dirty` is set by an effect, and effects
   * run after the moment that matters on the way out: a transform applied in
   * `onDestroy` changed the document, the flag was still the clock's clean one,
   * and the move went with the studio unwritten.
   */
  let writtenDoc: ToonDocument | null = null;
  /** The layer tags that write took: they ride the record, not the document. */
  let writtenTags = '';

  // Track the change signals (fps, frame count, per-frame stroke count —
  // strokes are append-only). Skipping the untouched document also avoids
  // clobbering a draft before restore runs.
  $effect(() => {
    if (!editor.touched) {
      return;
    }
    // The document is one value and every write replaces it, so this is the
    // whole subscription. It used to be a walk over every cell of every
    // layer — frames × layers reads on each stroke.
    // The document the last write took is not a change: a save by hand
    // applies a live move and writes it before this effect runs, and the
    // flag it cleared came back on — Save lit, the tab asking over a record
    // already on disk.
    // A layer's tag is an edit kept beside the document: changed after a
    // write it lit nothing, and went with the tab. Read first, so the effect
    // hears it whatever the document says.
    const tags = editor.layerColors.join();
    if (editor.doc !== writtenDoc || tags !== writtenTags) {
      dirty = true;
    }
  });

  /** A write into working storage failed: stop trying and say so, once. */
  let saveFailed = $state(false);
  /** The browser keeps no storage for this page: nothing is ever written. */
  let storageBlocked = $state(false);
  /** The clock came round during playback; the write waits for the stop. */
  let queued = false;
  /** Size of the record as last written — what the indicator reports. */
  let savedBytes = $state(0);
  /**
   * Draft writes started and not yet landed. `dirty` is cleared as a write
   * starts, and a tab closed in between went without a question — the
   * browser drops a transaction still open when the page goes.
   */
  let writing = 0;

  /**
   * Writes the draft right now — the autosave clock, Ctrl+S and the sheet.
   * After a failure the clock stays off, but a save asked for by hand tries
   * again: the user may have freed the room in the drafts list since.
   */
  function saveNow(byHand = false, leaving = false, shown?: ToonDocument): Promise<boolean> {
    // `shown` is an edit by itself: a move on a draft just opened and not
    // touched since went unwritten into the background.
    if (!editor.touched && !shown) {
      return Promise.resolve(true);
    }
    // Leaving is the last chance, failure or not: the list may have been
    // cleared since, and nobody is left to press Ctrl+S.
    if (saveFailed && !byHand && !leaving) {
      return Promise.resolve(false);
    }
    // The document is a value the editor holds whole, so it goes to storage as
    // it is: no snapshot to take, and no second pass over every stroke of the
    // drawing to size what the write is about to size anyway.
    // `shown` is the drawing with a live transform applied (flushOnHide).
    const doc = shown ?? editor.doc;
    // Lands only on a record that has no track yet — see `saveDraft`.
    const { blob, name, author, sync } = editor.audio;
    const track = blob ? { blob, name, author, sync, bytes: blob.size } : null;
    queued = false;
    dirty = false;
    writtenDoc = doc;
    writtenTags = editor.layerColors.join();
    writing++;
    return saveDraft(draftId, doc, editor.sessionState(), track).finally(() => writing--).then(({ ok, bytes }) => {
      if (ok && bytes === 0) {
        // No storage at all (blocked by the browser): the store degrades
        // quietly, but «сохранено» would be a lie, and a clean `dirty` would
        // let the tab close over the only copy without a word.
        storageBlocked = true;
        dirty = true;
        return true;
      }
      if (ok) {
        editor.lastSavedAt = Date.now();
        savedBytes = bytes;
        saveFailed = false;
        // Storage that was away for a moment (an upgrade in another tab) is back.
        storageBlocked = false;
        writeScreenshot(doc);
        return true;
      }
      if (leaving) {
        // No alert on the way out: the status says it, the tab still asks.
        saveFailed = true;
        dirty = true;
      } else {
        saveFailedNow();
      }
      return false;
    });
  }

  /**
   * A write into working storage failed: the status says so, the clock stops,
   * the tab warns before closing, and Ctrl+S tries again.
   */
  function saveFailedNow(): void {
    saveFailed = true;
    dirty = true;
    void tell(t('editor.save_failed_alert'));
  }

  /**
   * Ctrl+S and the «Сохранить» key: what the screen shows is what is saved, a
   * live move applied first, as a publish and an export do; under the lock it
   * refuses with a hint. The key skipped the move and wrote the drawing
   * without it.
   */
  function saveByHand(): void {
    if (editor.leaveTransform()) {
      void saveNow(true);
    }
  }

  /** Called by the transport when a preview stops: the deferred write lands now. */
  export function saveQueued(): void {
    if (queued) {
      saveNow();
    }
  }

  /**
   * The card's thumbnail: rendered once per write, when the CPU is free.
   * Drawing it inline would cost a frame of the stroke that triggered it.
   */
  function writeScreenshot(doc: ToonDocument): void {
    // The record this write belongs to, captured now: by the time the browser
    // is idle a file may have been opened and `draftId` moved on.
    const id = draftId;
    const idle = globalThis.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 500));
    idle(() => {
      void renderScreenshot(doc)
        .then((blob) => setDraftScreenshot(id, blob))
        .catch((err) => console.warn('draft screenshot failed:', err));
    });
  }

  /**
   * Reference Alt+S in the Toonio preset: the project leaves as a file in our
   * own `.toonop` — the document exactly as the draft and the API hold it, no
   * wrapper. Sound and palette stay in the draft, as they do in a `.toon`.
   */
  async function saveProjectFile(): Promise<void> {
    // The file takes what the screen shows: a live move applied first.
    if (!editor.leaveTransform()) {
      return;
    }
    if (!(await ask(t('editor.download_project_confirm')))) {
      return;
    }
    // Not JSON to the browser: Safari names a JSON download `toonop.toonop.json`.
    saveFile(new Blob([JSON.stringify(editor.doc)], { type: 'application/octet-stream' }), 'toonop.toonop');
  }

  // The track rides the draft but not the document: it is written on its own
  // whenever the file or its credits change, so an autosave never carries a
  // 10 MB blob and attaching a track never waits for the autosave clock.
  /**
   * The track already in the draft on disk. A restored track must not be
   * written straight back: it is megabytes of IndexedDB traffic for a record
   * that already holds them, it lands a second or two after the draft opens —
   * right when the preview is starting — and re-`put`ting a Blob that the
   * playing `<audio>` element is reading through an object URL is asking the
   * browser to swap the file under it.
   */
  let storedBlob: Blob | null = null;
  /** The light metadata as it stands on disk, so restoring it writes nothing. */
  let storedCredits = '';

  $effect(() => {
    const blob = editor.audio.blob;
    if (blob === storedBlob) {
      return;
    }
    const { name, author, sync } = untrack(() => editor.audio);
    storedBlob = blob;
    storedCredits = `${name}\u0000${author}\u0000${sync}`;
    void setDraftAudio(
      // Not heard: a draft opened (its id) while its own track was still
      // being read re-ran this with the last draft's track in hand, and that
      // one went into the opened record.
      untrack(() => draftId),
      blob ? { blob, name, author, sync, bytes: blob.size } : null,
    ).then((ok) => {
      if (!ok && blob) {
        // The record still has no track, so the save by hand carries it.
        saveFailedNow();
      }
    });
  });

  // The credits are their own write. Reading them in the effect above would
  // put the whole file again on every keystroke — megabytes per character.
  $effect(() => {
    const { name, author, sync } = editor.audio;
    const credits = `${name}\u0000${author}\u0000${sync}`;
    // While a track is being read the fields still hold the last one's: a
    // draft just opened took the previous draft's name and author.
    if (credits === storedCredits || editor.audio.loading || !untrack(() => editor.audio.hasTrack)) {
      return;
    }
    storedCredits = credits;
    void setDraftCredits(draftId, name, author, sync);
  });

  // Autosave on the reference's clock (AutoSave, every 60 s by default). A
  // trailing debounce was wrong here: with a minute-long interval a hand that
  // keeps drawing would reset it forever and never write anything.
  $effect(() => {
    const ms = editor.settings.autosaveMs;
    if (ms === 0 || saveFailed) {
      // «никогда» — no clock; leaving the studio still writes (flushOnLeave).
      // After a failed write the clock stays off until the page is reloaded
      // (`toon.js:99-109`).
      return;
    }
    const timer = setInterval(() => {
      // A hidden tab was written as it went (flushOnHide) and nothing is
      // drawn in it: the clock waits, or it wrote the document over the
      // record that holds the live move.
      if (!dirty || document.hidden) {
        return;
      }
      // The reference defers a write until playback is over — `saveQueued`
      // writes it the moment the transport stops.
      if (editor.playing) {
        queued = true;
        return;
      }
      saveNow();
    }, ms);
    return () => clearInterval(timer);
  });

  // Drafts saved on this device. The reference keeps every local save and
  // greets you with "Доступно локальное сохранение!" rather than loading the
  // last one behind your back (`toonio.bundle.js:233`) — so does this: the
  // studio opens on the hub, drafts or none (owner, 2026-10-05), and a draft
  // is loaded only when picked. The sheet for a new drawing is chosen there.
  // Up from the first frame: the studio showed for a blink while the hub
  // waited for the drafts to be read (owner, 2026-10-05). `draftsRead` tells
  // the hub when it has them.
  let draftsOpen = $state(untrack(() => startNew === true || editor.settings.showDraftsOnStart));
  // The host's note walks a first visit to its end — a line, a second frame,
  // play — so the host is told how far the toon has come (a line drawn, the
  // count of frames, playing) and says when it has nothing left to say. The
  // studio only keeps the note from under the hub and a phone's «⋯» window.
  const noteDue = $derived(!draftsOpen && !moreOpen);
  // The first visit's presets stand over the empty sheet; the first line — or
  // a drawing opened — ends the question for good.
  $effect(() => {
    if (!isEmptyDocument(editor.doc)) editor.closePresetAsk();
  });
  // A phone's sheet fills its stage, so a note on the stage lay on the paper
  // the first line is meant for (owner, 2026-10-08): there it stands in the
  // bottom bar, over the «+» it speaks of. A bare bar lying down has no room.
  const noteInPanel = $derived(compact && !panelFolded && !barBare && panels.rows.length > 0);
  // Everywhere else — a phone lying down, a wide screen — the note is a line of
  // the bar over the canvas: no note lies on the sheet any more (owner,
  // 2026-10-08, «пофикси везде»). The stage is left for a layout with no bar.
  const noteInTop = $derived(!noteInPanel && draws(panels.top) && !editor.arranging);
  let draftsRead = $state(false);
  // Raw: `$state` hands every entry out as a proxy, the document in it too —
  // a draft opened from the list was one IndexedDB refuses to write
  // (DataCloneError), so nothing drawn on it since was ever saved.
  let drafts = $state.raw<DraftEntry[]>([]);
  /** How much of the device's storage everything on it takes, for the header. */
  let storageUsed = $state(0);

  /**
   * Object URLs for the cards' screenshots, one per record. Made here rather
   * than in the markup: a URL minted while rendering is minted again on every
   * re-render, and every one of them pins its blob in memory for the session.
   */
  let thumbUrls = $state<Record<string, string>>({});

  /**
   * The studio goes without `beforeunload`: a site link unmounts it, and a
   * phone sends the tab to the background and may kill it there. Either way
   * the strokes since the last turn of the clock went with it, unasked. They
   * are written now, «никогда» or not: that setting stops the clock only
   * (owner, twelfth audit).
   */
  function flushOnLeave(): void {
    if (dirty || (editor.touched && editor.doc !== writtenDoc)) {
      void saveNow(false, true);
    }
  }

  /**
   * The tab went to the background: the draft is written as the screen shows
   * it, a selection moved and not yet applied included — but the selection
   * stays live in the hand, so a copy with the move applied is what is written.
   */
  function flushOnHide(): void {
    const shown = editor.docWithTransform();
    if (shown !== editor.doc) {
      void saveNow(false, true, shown);
      // The record is now ahead of the document. Dropped by Esc after the
      // return, the move stayed in the draft: Save was dark, the clock had
      // nothing to write and the tab closed unasked. Unsaved again — the
      // clock puts the record right once the tab is back.
      editor.touched = true;
      dirty = true;
      return;
    }
    flushOnLeave();
  }

  /** The studio is gone: late answers from storage have nothing to update. */
  let destroyed = false;
  // The site leaves the studio without a reload. The track is a media element
  // nothing unmounts — a preview running at that moment went on sounding over
  // the feed — and its blob and the cards' thumbnails stay pinned by their URLs.
  onDestroy(() => {
    destroyed = true;
    // A selection moved and not yet applied is on the screen, not in the
    // document: leaving applies it, as a frame change does. Under the lock
    // it stays live, and the draft takes it as a hidden tab's does.
    editor.leaveTransform();
    flushOnHide();
    editor.audio.clear();
    for (const url of Object.values(thumbUrls)) {
      URL.revokeObjectURL(url);
    }
  });

  async function refreshDrafts(): Promise<void> {
    const records = await listDrafts();
    // Read after the studio was left: URLs minted now would be revoked by nobody.
    if (destroyed) {
      return;
    }
    drafts = draftEntries(records);
    for (const url of Object.values(thumbUrls)) {
      URL.revokeObjectURL(url);
    }
    thumbUrls = Object.fromEntries(
      drafts.flatMap((entry) => (entry.screenshot ? [[entry.id, URL.createObjectURL(entry.screenshot)]] : [])),
    );
    storageUsed = (await navigator.storage?.estimate?.().catch(() => null))?.usage ?? 0;
  }

  /** Reference «копия»: the same drawings under new keys, the originals untouched. */
  async function copyDrafts(sources: string[]): Promise<void> {
    let failed = false;
    for (const id of sources) {
      failed = !(await duplicateDraft(id)) || failed;
    }
    await refreshDrafts();
    // The sources are still there, so a copy is what did not fit.
    if (failed && sources.every((id) => drafts.some((d) => d.id === id))) {
      void tell(t('editor.draft_copy_failed'));
    }
  }

  /**
   * The records picked in the hub as a file — the same `.toonops` the settings export
   * writes, so it comes back through the same import with its screenshots,
   * its tracks and the hand each was saved with.
   */
  async function downloadDrafts(ids: string[]): Promise<void> {
    try {
      const text = await exportDrafts(ids);
      saveFile(new Blob([text], { type: 'application/octet-stream' }), ids.length === 1 ? 'draft.toonops' : 'drafts.toonops');
    } catch (err) {
      // A stored blob that will not read (Safari loses them), or a string
      // past the engine's length: the key did nothing and nobody heard why.
      console.warn('draft download failed:', err);
      void tell(t('settings.drafts_save_failed'));
    }
  }

  /** «Удалить все»; says whether it was done, so the hub can place the focus. */
  async function removeAllDrafts(): Promise<boolean> {
    if (!(await ask(t('editor.drafts_wipe_confirm'), t('ask.delete'), true))) {
      return false;
    }
    await deleteAllDrafts();
    forgetStoredDraft();
    await refreshDrafts();
    return true;
  }

  onMount(async () => {
    // One place the editor asks from — the state calls it for frames, layers
    // and pastes alike.
    editor.ask = (message: string, yes?: string, final?: boolean) => ask(message, yes, final);
    editor.askNow = (message: string) => confirm(message);
    editor.tell = tell;
    editor.askText = askText;
    // The transport defers a write until the preview is over and tells us here.
    editor.onStop = saveQueued;
    // Ask the browser to keep the drafts: without this they are evictable the
    // moment the device is short of space.
    void navigator.storage?.persist?.().catch(() => false);
    await refreshDrafts();
    draftsRead = true;
  });

  async function openDrafts(): Promise<void> {
    // The card's copy and download take the drawing as the screen shows it.
    editor.leaveTransform();
    // The effect that marks the applied move runs after this.
    if (editor.touched && editor.doc !== writtenDoc) {
      dirty = true;
    }
    if (dirty) {
      // The current card is copied and downloaded from what is on disk: up to
      // a clock's turn behind the canvas without this write.
      await saveNow();
    }
    await refreshDrafts();
    // «Настройки» has closed by now and handed the focus back to its key.
    hubFrom = document.activeElement;
    hubFromStudio = true;
    draftsOpen = true;
  }

  /** Loads a saved draft; the current drawing is replaced, so a touched one asks. */
  async function openDraft(entry: DraftEntry): Promise<void> {
    // The draft on the canvas is newer than its card: the list was read when
    // the sheet opened, and loading it would put back the older copy.
    if (entry.id === draftId) {
      hub?.close();
      return;
    }
    // A selection moved and not applied belongs to the drawing being left: it
    // goes into its draft, not away with the document swap. The lock refuses.
    if (!editor.leaveTransform()) {
      return;
    }
    if (editor.touched) {
      if (!(await ask(t('editor.draft_open_confirm')))) {
        return;
      }
      // By hand, so a clock stopped by a failure tries once more; a drawing
      // that did not reach the disk is not replaced.
      if (!(await saveNow(true))) {
        return;
      }
    }
    editor.openDraft(entry.doc);
    if (entry.state) {
      editor.restoreState(entry.state);
    }
    // Claimed before the restore, which is async: the effect must already know
    // this blob is the one on disk by the time the track is adopted.
    storedBlob = entry.audio?.blob ?? null;
    storedCredits = entry.audio
      ? `${entry.audio.name}\u0000${entry.audio.author}\u0000${entry.audio.sync ?? true}`
      : '';
    if (entry.audio) {
      void editor.audio.restore(entry.audio);
    } else {
      editor.audio.clear();
    }
    draftId = entry.id;
    editor.lastSavedAt = null;
    // close(), not the flag: an unmounted open dialog drops focus on <body>.
    hub?.close();
  }

  /** Deletes the drafts picked in the hub; says whether it was done. */
  async function removeDrafts(ids: string[]): Promise<boolean> {
    // The drawing on the sheet outlives its card (`forgetStoredDraft`), and
    // the question says so (owner, 2026-10-08).
    const open = ids.includes(draftId) && !isEmptyDocument(editor.doc);
    const question =
      ids.length === 1
        ? open ? t('editor.draft_delete_open_confirm') : t('editor.draft_delete_confirm')
        : t('editor.drafts_delete_confirm', { count: ids.length }) + (open ? ` ${t('editor.drafts_delete_open')}` : '');
    if (!(await ask(question, t('ask.delete'), true))) {
      return false;
    }
    for (const id of ids) {
      await deleteDraft(id);
    }
    if (ids.includes(draftId)) {
      forgetStoredDraft();
    }
    await refreshDrafts();
    return true;
  }

  /**
   * «Рисовать»: the sheet put together. Over a drawing it is a new one: the
   * drawing left behind is written first and stays a card in the hub, so
   * nothing is asked — unless it did not reach the disk. Says whether the
   * sheet was started: the hub closes on a yes.
   */
  async function startSheet(value: string, fps: number): Promise<boolean> {
    if (!editor.sheetOpen) {
      if (!editor.leaveTransform()) {
        return false;
      }
      if (editor.touched) {
        const saved = (await saveNow(true)) && !storageBlocked;
        if (!saved && !(await ask(t('editor.new_sheet_lost_confirm')))) {
          return false;
        }
      }
      editor.newSheet();
      editor.audio.clear();
      storedBlob = null;
      storedCredits = '';
      draftId = newDraftId();
      editor.lastSavedAt = null;
    }
    editor.setSheet(value, fps);
    return true;
  }

  /**
   * The drawing on screen was published (owner, 2026-10-06): its draft on this
   * device goes. Clean from here, so leaving the studio — which writes whatever
   * is unsaved — does not put it back; drawing on starts a record of its own.
   */
  async function forgetSent(): Promise<void> {
    await deleteDraft(draftId);
    draftId = newDraftId();
    editor.lastSavedAt = null;
    editor.touched = false;
    dirty = false;
  }

  /** «Отправить мульт»: the key's work, and the export sheet's way on. */
  function sendOut(): void {
    // A live transform is on the screen and not yet in the document: the
    // mult went out with the selection where it was lifted. The lock
    // refuses and says so, as it does for a frame change.
    if (!editor.leaveTransform()) return;
    // The server would refuse it after the form was filled in: said here.
    if (editor.budgetShare > 1) {
      void tell(t('editor.publish_over_budget', { percent: budgetLabel(editor.budgetShare).text }));
      return;
    }
    onPublish?.(
      $state.snapshot(editor.doc),
      editor.audio.blob
        ? {
            blob: editor.audio.blob,
            name: editor.audio.name,
            author: editor.audio.author,
            sync: editor.audio.sync,
          }
        : null,
      forgetSent,
    );
  }

  /**
   * The record behind the drawing on screen is gone (owner, after the tenth
   * audit): the drawing is unsaved again — Save lights up, closing the tab
   * warns — and the next save makes a new record, track and all.
   */
  function forgetStoredDraft(): void {
    draftId = newDraftId();
    // `storedBlob` stays: the save that makes the record carries that track.
    editor.lastSavedAt = null;
    if (!isEmptyDocument(editor.doc)) {
      editor.touched = true;
      dirty = true;
    }
  }

  /**
   * Reference warning on the first mega-eraser of the session: the tool
   * rewrites the strokes of a cell in place, so the draft written right after
   * it is the way back.
   */
  const MEGA_ERASER_WARNING =
    t('editor.mega_eraser_warning');

  $effect(() => {
    if (editor.tool !== 'mega-eraser' || editor.megaEraserWarned) {
      return;
    }
    editor.megaEraserWarned = true;
    if (editor.settings.megaEraserWarning) {
      megaWarnOpen = true;
    }
    // «Сохранён» only once it is: the write may fail, or reach no storage.
    saveNow().then((ok) => (megaDraftSaved = ok && !storageBlocked));
  });

  let fileInput = $state<HTMLInputElement | undefined>();
  /** Import failure, shown until the next attempt, the next drawing or the next line. */
  let importError = $state('');
  // It is about the drawing it was said over: once that drawing changes — a
  // line, another draft, a new sheet — it is old news lying on the canvas.
  // Not under the hub: a handed drawing that failed is said over the studio,
  // which nobody has seen yet while the sheet for a new one is being chosen.
  let importErrorSeen = false;
  $effect(() => {
    void editor.doc;
    const first = !importErrorSeen;
    importErrorSeen = true;
    if (!first && untrack(() => !draftsOpen || hubFromStudio)) {
      importError = '';
    }
  });

  // The host's drawing, once, as the studio comes up: past the hub, validated
  // like a file and under a draft record of its own. Its track is not on this
  // device yet, so the autosave is left to write it.
  const handed = untrack(() => open);
  if (handed) {
    try {
      adoptOpenedDoc(loadDocument(handed.doc), '');
      // Only once it is in: a drawing that did not open leaves the usual start.
      draftsOpen = false;
      if (handed.audio) {
        void editor.audio.restore(handed.audio);
      }
    } catch (err) {
      console.warn('handed drawing failed:', err);
      importError = t('editor.file_failed', { reason: t('editor.file_not_toonop') });
    }
  }

  /**
   * The one door every drawing comes in through: the file dialog and a drop on
   * the window. The decoder is picked by extension, as the reference does
   * (`bundle:7341-7355`) — `.toonop` is our own document, `.toon` the binary
   * Tonio file, `.json` its pre-binary save. The current drawing is replaced,
   * so a touched document asks first and its draft is written before it goes.
   */
  async function openFile(file: File): Promise<void> {
    importError = '';
    // As opening a draft: the live move is applied into the drawing it was
    // made on before that drawing is written and replaced.
    if (!editor.leaveTransform()) {
      return;
    }
    const name = file.name.toLowerCase();
    let doc: ToonDocument;
    let original = '';
    let text = '';
    try {
      if (name.endsWith('.toonop') || name.endsWith('.json')) {
        text = await file.text();
      }
      // Safari saves `toonop.toonop` as `toonop.toonop.json`: ours by what is in it.
      if (name.endsWith('.toonop') || (name.endsWith('.json') && isToonopJson(text))) {
        doc = loadDocument(JSON.parse(text));
      } else if (name.endsWith('.json')) {
        const result = decodeLegacyJson(text);
        if (!result.ok) {
          importError = t('editor.file_failed', { reason: result.error });
          return;
        }
        doc = result.doc;
      } else if (name.endsWith('.toon')) {
        const result = decodeToon(await file.arrayBuffer());
        if (!result.ok) {
          importError = t('editor.file_failed', { reason: result.error });
          return;
        }
        doc = result.doc;
        original = result.original;
      } else {
        importError = t('editor.file_unsupported');
        return;
      }
    } catch (err) {
      // What throws here is our own document's validator — a JSON path and
      // a schema rule, which says nothing to the person holding the file.
      console.warn('file open failed:', err);
      // Moved, deleted or still in the cloud: the file is not damaged, it is
      // not there to read (`NotReadableError`, `NotFoundError`).
      if (err instanceof DOMException) {
        importError = t('editor.file_failed', { reason: t('editor.file_unreadable') });
        return;
      }
      // A project from a newer editor is not damaged: it says which version it is.
      const newer = err instanceof FormatError
        ? err.issues.find((issue) => issue.category === 'unsupported-version')
        : undefined;
      const version = newer ? (JSON.parse(text) as { schema_version?: unknown }).schema_version : undefined;
      importError = t('editor.file_failed', {
        reason: newer ? t('file.version_unsupported', { version: String(version) }) : t('editor.file_not_toonop'),
      });
      return;
    }
    // Asked once the file is known to open: «Текущий рисунок будет заменён?»
    // answered yes, and then «файл повреждён», was a question about nothing.
    if (editor.touched) {
      // A browser that keeps no drafts loses the drawing outright: the question says so.
      const question = storageBlocked ? 'editor.file_open_lost_confirm' : 'editor.file_open_confirm';
      if (!(await ask(t(question, { name: file.name })))) {
        return;
      }
      if (!(await saveNow(true))) {
        return;
      }
      // That write is what learnt the browser keeps nothing: the question asked was about a drawing replaced, not lost.
      if (storageBlocked && question !== 'editor.file_open_lost_confirm' && !(await ask(t('editor.file_open_lost_confirm', { name: file.name })))) {
        return;
      }
    }
    adoptOpenedDoc(doc, original);
  }

  /**
   * What the reference does around a file it has just read: the drawing
   * replaces the current one, the grid takes the colours it uses, the track
   * goes (a file carries none) and the visit starts a new draft record so the
   * opened file does not overwrite what was being drawn before it.
   */
  function adoptOpenedDoc(doc: ToonDocument, original: string): void {
    editor.importDoc(doc);
    editor.original = original;
    editor.stealPalette(doc);
    editor.audio.clear();
    storedBlob = null;
    storedCredits = '';
    draftId = newDraftId();
    // «Сохранено локально» was the previous drawing's: this one is not on disk yet.
    editor.lastSavedAt = null;
  }

  /** A drafts bundle: ours, toonio.ru's, and either with Safari's `.json` on the end. */
  const DRAFTS_FILE = /\.(toonops|toonio)(\.json)?$/i;

  /**
   * A file dropped anywhere on the window (`bundle:7341-7407`): a drawing
   * opens, a sound is attached, anything else is named rather than ignored.
   */
  /**
   * A modal sheet is up — settings, drafts, export, plugins, a question, any
   * `showModal()`. None of them has a drop zone of its own, so a file dropped
   * then would change the drawing under the sheet: it is refused instead.
   */
  function sheetOpen(): boolean {
    return document.querySelector(SHEET_UP) !== null;
  }
  /** The refusal, as a note above the sheet (the top layer), for a moment. */
  let dropNote = $state(false);
  let dropNoteEl = $state<HTMLElement | undefined>();
  let dropNoteTimer = 0;
  function refuseDrop(): void {
    dropNote = true;
    clearTimeout(dropNoteTimer);
    dropNoteTimer = setTimeout(() => (dropNote = false), 3000) as unknown as number;
  }
  /**
   * The popover API: Safari 17 and Firefox 125 on. Without it (Safari 16 is the
   * last on an iPhone 8 or X) `:popover-open` is a selector that throws — in
   * an effect, at mount, so the studio did not come up at all. The note is then
   * shown by its class under the sheet rather than above it.
   */
  const popovers = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
  /**
   * The key under the cursor (or the keyboard's focus), named: what its title
   * says, on a plate by the key, at once. The icon used to be swapped for the
   * shortcut's letter — just as it was being looked at. The title is taken off
   * while the plate is up: the browser's own tooltip said the same a second
   * later.
   */
  /** A key of the row has been pressed: the names have been read, and what it opens lies where they hang. */
  let rowPressed = $state(false);
  let keyName = $state<{ text: string; x: number; y: number; over: boolean } | null>(null);
  let keyNameEl = $state<HTMLElement | undefined>();
  let namedKey: Element | null = null;
  function nameKey(e: PointerEvent | FocusEvent): void {
    // A finger has no hover: the plate would stick after the tap.
    if ('pointerType' in e ? e.pointerType !== 'mouse' : !(e.target as Element).matches(':focus-visible')) return;
    const key = (e.target as Element).closest('.key');
    if (key === namedKey) return;
    unnameKey();
    const text = key?.matches(':disabled') ? null : key?.getAttribute('title') ?? key?.getAttribute('aria-label');
    if (!key || !text || key.textContent?.trim() === text) return;
    const box = key.getBoundingClientRect();
    const over = box.top > window.innerHeight / 2;
    namedKey = key;
    if (key.hasAttribute('title')) {
      key.setAttribute('data-title', text);
      key.removeAttribute('title');
    }
    keyName = { text, x: box.left + box.width / 2, y: over ? box.top : box.bottom, over };
  }
  function unnameKey(): void {
    const title = namedKey?.getAttribute('data-title');
    if (namedKey && title !== null && title !== undefined && !namedKey.hasAttribute('title')) namedKey.setAttribute('title', title);
    namedKey?.removeAttribute('data-title');
    namedKey = null;
    keyName = null;
  }
  $effect(() => {
    const el = keyNameEl;
    if (!el || !popovers) return;
    // Above whatever sheet is on top now, as the drop note.
    if (el.matches(':popover-open')) el.hidePopover();
    if (keyName) el.showPopover();
  });
  // Kept whole on the screen: a key at the edge has half a plate past it.
  $effect(() => {
    const el = keyNameEl;
    if (!el || !keyName) return;
    const half = el.offsetWidth / 2 + 8;
    el.style.left = `${Math.max(half, Math.min(keyName.x, window.innerWidth - half))}px`;
  });
  /**
   * An arrange handle whose key the profile does not draw is marked
   * `data-empty` and hidden. Not `:has()`: Firefox 115 has none, and the rule
   * with it went whole, leaving empty handles standing on the panels.
   */
  function markEmpty(body: HTMLElement): { destroy(): void } {
    const handle = body.parentElement;
    const mark = () => handle?.toggleAttribute('data-empty', body.childElementCount === 0);
    mark();
    const watch = new MutationObserver(mark);
    watch.observe(body, { childList: true });
    return { destroy: () => watch.disconnect() };
  }
  $effect(() => {
    const el = dropNoteEl;
    if (!el) {
      return;
    }
    if (!popovers) {
      return;
    }
    // Hidden and shown again on each refusal, so it lands above the sheet
    // that is on top now, not the one that was when it first opened.
    if (el.matches(':popover-open')) {
      el.hidePopover();
    }
    if (dropNote) {
      el.showPopover();
    }
  });
  function onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) {
      return;
    }
    // Always taken by the page, or the browser opens the file itself.
    e.preventDefault();
    if (sheetOpen()) {
      e.dataTransfer.dropEffect = 'none';
      if (!dropNote) {
        refuseDrop();
      }
    }
  }

  function onDrop(e: DragEvent): void {
    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    e.preventDefault();
    // The update lock: the keys are off, and a drop is no different.
    if (editor.updating) {
      return;
    }
    if (sheetOpen()) {
      refuseDrop();
      return;
    }
    // `.json` on the end is Safari's, which names a download by its type.
    if (DRAFTS_FILE.test(file.name)) {
      void openDraftsFile(file);
    } else if (/\.(toonop|toon|json)$/i.test(file.name)) {
      void openFile(file);
    } else if (isAudioFile(file)) {
      // A refusal still up from the last drop is not about this file.
      importError = '';
      void editor.audio.load(file, file.name.replace(/\.[^.]+$/, ''), editor.audio.author);
      audioOpen = true;
    } else {
      importError = t('editor.file_unsupported');
    }
  }
  /**
   * A drafts bundle dropped on the window: the same load as «Загрузить
   * черновики…» in the settings, then the list, where they now are.
   */
  /** The note goes with its key; the focus would fall to <body> with them. */
  function dismissImportError(): void {
    importError = '';
    document.querySelector<HTMLElement>(`[data-tool="${CSS.escape(editor.tool)}"]`)?.focus();
  }

  async function openDraftsFile(file: File): Promise<void> {
    importError = '';
    if (!(await ask(t('settings.drafts_confirm', { name: file.name })))) {
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      // Moved or deleted since the drop, as in the settings: not the storage's fault.
      console.warn('drafts file unreadable:', err);
      importError = t('settings.drafts_unreadable');
      return;
    }
    try {
      const { loaded, broken } = await importDrafts(text);
      if (broken > 0 || loaded === 0) {
        importError = loaded > 0 || broken > 0
          ? t(broken > 0 ? 'settings.drafts_loaded_broken' : 'settings.drafts_loaded', { loaded, broken })
          : t('settings.no_drafts');
      }
      if (loaded > 0) {
        await openDrafts();
      }
    } catch (err) {
      console.warn('drafts import failed:', err);
      importError = t('settings.drafts_load_failed');
    }
  }

  // The reference's settings window: drawing, palette, autosave, view.
  let settingsSheetOpen = $state(false);

  function openSettingsSheet(): void {
    // «Скачать черновики» there: the live move goes into the record first.
    editor.leaveTransform();
    // The effect that marks the applied move runs after this.
    if (editor.touched && editor.doc !== writtenDoc) {
      dirty = true;
    }
    if (dirty) {
      // «Скачать черновики» there reads the records: the current one as drawn.
      void saveNow();
    }
    settingsSheetOpen = true;
  }

  /** Installed plugins and the catalog — its own window, off the settings sheet. */
  let pluginsSheetOpen = $state(false);

  /**
   * «сохранено локально <дата> <размер>» on the panel — the reference names
   * the storage, when it last wrote and how heavy the record has become.
   */
  const lastSaved = $derived(
    editor.lastSavedAt === null
      ? ''
      : new Date(editor.lastSavedAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }),
  );

  // Reference «Мануал» (`E:61-63`) opens the site's manual page; we have none,
  // so the button opens the list of keys the editor actually implements.
  let manualOpen = $state(false);
  // What a finger does that no key on screen says: under one, these lead the
  // manual; under a cursor the keys do.
  const GESTURES = ['two_fingers', 'hold_sheet', 'hold_frame', 'hold_layer'] as const;
  const touchFirst = $derived(manualOpen && matchMedia('(hover: none)').matches);
  // Nothing that hovers at all — no mouse, so no keyboard to speak of: the
  // manual is the gestures alone, not thirty keys the phone does not have.
  const fingersOnly = $derived(manualOpen && matchMedia('(any-hover: none)').matches);

  // Mirrors the key handler above one-for-one. If a case is added there and not
  // here, the sheet lies — keep them next to each other for that reason. A key
  // whose meaning the preset decides says this studio's meaning, and a tool key
  // shows only where the tool is on the panel.
  const has = (tool: string): boolean => editor.availableTools.includes(tool);
  const SHORTCUTS: [string, string][] = $derived(
    (
      [
        ['B', t('key.pencil')],
        ['E', t('key.eraser')],
        hasMegaEraser && ['Alt + E', t('tool.mega_eraser.label')],
        ['P', t('key.pipette')],
        ['Shift + Enter', t('key.pick_fill')],
        has('drag') && ['D / O', t('tool.hand.label')],
        // The hand's own keys, before size and steps: the only keyboard zoom.
        has('drag') && ['+ / −, ←→↑↓', t('key.hand_keys')],
        has('lasso') && ['Q / S', t('tool.transform.label')],
        has('lasso') && ['Q / W', t('key.transform_turn')],
        has('lasso') && ['Enter / Esc', t('key.transform_apply')],
        has('distort') && ['~', t('tool.jitter.label')],
        ['H / Shift + H', t('key.mirror')],
        ['+ / −', t('key.brush_size')],
        ['M, Ctrl + M', quickPalette ? t('key.palette') : t('key.merge')],
        ['Z, Ctrl + Z', t('key.undo')],
        ['Y, Ctrl+Shift+Z', t('key.redo')],
        ['C, Ctrl + C', t('key.copy')],
        ['V, Ctrl + V', t('key.paste')],
        ['Ctrl + X', t('key.cut')],
        // Without a fullscreen here (an iPhone) the key and its button are not there either.
        (hasFeather || document.fullscreenEnabled) && ['F', hasFeather ? t('tool.feather.label') : t('key.fullscreen')],
        // F7 is the frame's key with the letters off: the row went with «A».
        ['A, F7', t('key.add_frame')],
        ['Del / Backspace', t('key.delete_frame')],
        ['J / L', t('key.ends')],
        ['← / →', t('key.steps')],
        ['↑ / ↓', t('key.layers')],
        ['Shift + ←→↑↓', t('key.extend')],
        ['Ctrl + Shift + ←→↑↓', t('key.pan_sheet')],
        ['K', t('key.onion')],
        ['X', t('key.swap')],
        ['Space', t('key.preview')],
        ['Ctrl + S', t('key.save')],
        ['Alt + S', hasProjectFile ? t('key.download_project') : t('key.export')],
        ['Alt + L', t('key.error_log')],
        // A plugin's tool answers to its manifest's key (the default branch
        // of the handler): on the panel, it is in the sheet too.
        ...plugins
          .tools()
          .map((tool) => !tool.builtin && tool.key && has(tool.id) && ([tool.key.toUpperCase(), tool.label] as [string, string])),
      ] as ([string, string] | false | '')[]
    )
      .filter((row): row is [string, string] => Array.isArray(row))
      // With single-letter keys off their letters are not offered at all.
      .map(([keys, what]): [string, string] => [editor.keyHint(keys), what])
      .filter(([keys]) => keys !== ''),
  );

  // Copy/paste confirmation: the reference flashes the whole stage for 50 ms
  // (fadeSprite). Skipped under reduced motion — where the words stand in for
  // it on the stage. A reader hears them either way: the flash alone told
  // nobody who could not see it, and nobody at all with motion reduced.
  let flashVisible = $state(false);
  let clipNote = $state('');
  let clipShown = $state(false);
  /** The buffer as last told: a new one is a copy, the same one a paste. */
  let clipSeen: unknown = null;
  $effect(() => {
    if (editor.flashTick === 0) return;
    const copied = untrack(() => editor.copiedCells !== null && editor.copiedCells !== clipSeen);
    clipSeen = untrack(() => editor.copiedCells);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const word = t(copied ? 'editor.copied' : 'editor.pasted');
    // Emptied first, so the same word twice is announced twice.
    clipNote = '';
    const say = setTimeout(() => {
      clipNote = word;
      clipShown = still;
    }, 0);
    const hush = setTimeout(() => (clipNote = ''), 1500);
    if (!still) flashVisible = true;
    const timer = setTimeout(() => (flashVisible = false), 50);
    return () => {
      clearTimeout(timer);
      clearTimeout(say);
      clearTimeout(hush);
    };
  });

  function onAddFrame(e: MouseEvent): void {
    // Cmd too, as the keys take it: on a Mac Ctrl+click is the context menu.
    if (e.ctrlKey || e.metaKey) {
      editor.addFrameBeforeActive();
    } else {
      editor.addFrameAfterActive();
    }
  }

  const lastFrame = $derived(editor.doc.layers[0].frames.length - 1);
  /** «В начало» and «в конец»; a profile may keep Play and the steps alone (toonop). */
  const endKeys = $derived(transportKeys(editor.ux).ends);
  /** «Назад» and «вперёд» on a frame; a profile may keep Play alone (Multator). */
  const stepKeys = $derived(transportKeys(editor.ux).steps);

  function onFpsChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    // A field left empty keeps the rate: `Number('')` was the slowest one.
    editor.setFps(fpsFromField(input.value, editor.doc.frame_rate, editor.ux.fpsRange));
    input.value = String(editor.doc.frame_rate);
  }
</script>

<!-- A file dropped anywhere would otherwise navigate the page away from the
     unsaved drawing, so the window takes the drop and opens it instead. -->
<svelte:document
  onfullscreenchange={() => (isFullscreen = document.fullscreenElement !== null)}
  onvisibilitychange={() => document.visibilityState === 'hidden' && flushOnHide()}
/>

<svelte:window
  bind:innerHeight={viewportHeight}
  bind:innerWidth={viewportWidth}
  onkeydown={onKeydown}
  onpointerdowncapture={focusFrom.pointer}
  onfocusin={(e) => focusFrom.focus(e.target)}
  onpointermove={onDividerMove}
  onpointerup={onDividerUp}
  onpointercancel={onDividerUp}
  ondragover={onDragOver}
  ondrop={onDrop}
  onpagehide={() => {
    // The page is going (Safari on iOS sends no `beforeunload` at all): a
    // selection moved and not yet applied is applied, as leaving the studio
    // does, and written with the rest. The lock keeps it live: written
    // without it, the record a hidden tab had made with the move lost it.
    editor.leaveTransform();
    flushOnHide();
  }}
  onbeforeunload={(e) => {
    // Unsaved strokes on a sheet that has something on it: the write starts
    // now, and the browser's own dialog holds the tab while it may not have
    // landed yet — the last thing between them and a closed tab. A selection
    // moved and not applied is not in the document at all: it asks too (a
    // lasso only picked up has no step yet, and closes quietly).
    const unsaved = (editor.touched && (dirty || writing > 0) && !isEmptyDocument(editor.doc)) || editor.canUndoTransform;
    // With the move, as a hidden tab's: `pagehide` applies it and writes, but
    // a write begun there never lands — the page is gone before storage
    // answers — and a reload lost the move it had just asked about.
    flushOnHide();
    if (unsaved) {
      e.preventDefault();
    }
  }}
/>

<input
  bind:this={fileInput}
  type="file"
  hidden
  accept={pickerAccept('.toonop,.toon,.json')}
  aria-label={t('editor.open_project')}
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    // The same door as a drop: a drafts file picked here (Safari names it
    // `.toonops.json`, iOS offers every file) came back «нет кадров».
    if (file && DRAFTS_FILE.test(file.name)) {
      void openDraftsFile(file);
    } else if (file) {
      void openFile(file);
    }
  }}
/>

{#snippet history()}
  <button
    class="key"
    disabled={!editor.canUndo}
    onclick={() => editor.undo()}
    data-key={editor.keyHint('Z') || undefined}
    aria-keyshortcuts={editor.settings.letterKeys ? 'Z Control+Z' : 'Control+Z'}
    title={editor.keyHint(t('editor.undo_title'))}
    aria-label={t('editor.undo')}
  >
    <Icon name="undo" />
  </button>
  <button
    class="key"
    disabled={!editor.canRedo}
    onclick={() => editor.redo()}
    data-key={editor.keyHint('Y') || undefined}
    aria-keyshortcuts={editor.settings.letterKeys ? 'Y Control+Shift+Z' : 'Control+Shift+Z'}
    title={editor.keyHint(t('editor.redo_title'))}
    aria-label={t('editor.redo')}
  >
    <Icon name="redo" />
  </button>
{/snippet}

<!-- The column's inner edge: the border line, the drag band on top of it and
     the round fold handle in the middle of it. It is a grid item of its own —
     inside the column, its own scrolling would cut the circle in half. -->
{#snippet sideEdge(id: SideId, label: string)}
  <div
    class="side-edge edge-{id}"
    class:folded={folded(id)}
    class:at-left={atLeft(id)}
    class:dragging={resize?.side === id}
    style:--side-h={folded(id) ? undefined : `${sideH[id]}px`}
  >
    {#if !folded(id)}
      <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
           svelte-check's non-interactive rules do not model. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="side-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('editor.panel_width', { label })}
        aria-valuenow={sideWidth(id)}
        aria-valuemin={SIDE_WIDTH_MIN[id]}
        aria-valuemax={sideMax(id)}
        tabindex="0"
        onpointerdown={(e) => onSideDown(e, id)}
        onkeydown={(e) => onSideKey(e, id)}
        title={t('editor.panel_width_title')}
      ></div>
    {/if}
    <!-- The arrow points the way the panel is about to travel. -->
    <button
      class="fold"
      onclick={() => editor.toggleSide(id)}
      aria-expanded={!folded(id)}
      title={folded(id) ? t('editor.panel_expand') : t('editor.panel_fold')}
      aria-label={t('editor.panel_toggle', { action: folded(id) ? t('editor.expand') : t('editor.fold'), label })}
    >
      <Icon name={foldIcon(id, folded(id))} size={14} />
    </button>
  </div>
{/snippet}

<!-- Every movable piece of chrome, by id: which panel holds it, and in what
     order, comes from the config (panels.ts) — not from its place in this
     file. The gear and Publish are the two exceptions below. -->
{#snippet panelItem(id: string)}
  <!-- The register of plugins is no state, and a row keyed by its id is never
       drawn again: a plugin's key read before the plugin was in (a reload)
       stayed empty. Heard through `pluginsVersion`. -->
  {@const tool = (void editor.pluginsVersion, toolOfItem(id))}
  {#if tool}
    <ToolKey {editor} {tool} brush={toolOpensBrush(panels, tool)} />
  {:else if id === 'save'}
    <!-- Reference «Сохранить»: the draft goes to disk now rather than on the
         next turn of the autosave clock. Nothing to write, nothing to press. -->
    <button
      class="key icon"
      onclick={saveByHand}
      disabled={!dirty && !editor.canUndoTransform}
      data-key="Ctrl+S"
      aria-keyshortcuts="Control+S"
      title={t('editor.save_title')}
      aria-label={t('editor.save')}
    >
      <Icon name="save" />
    </button>
  {:else if id === 'history'}
    <div class="history">
      {@render history()}
    </div>
  {:else if id === 'manual'}
    <!-- Reference «Мануал» (`E:61-63`): the keys, with no key of its own. -->
    <button class="key icon" aria-haspopup="dialog" onclick={() => (manualOpen = true)} title={t('editor.manual')} aria-label={t('editor.manual')}>
      <Icon name="help" />
    </button>
  {:else if id === 'fullscreen'}
    {#if document.fullscreenEnabled}
      <button
        class="key icon"
        class:active={isFullscreen}
        aria-pressed={isFullscreen}
        onclick={toggleFullscreen}
        data-key={hasFeather ? undefined : editor.keyHint('F') || undefined}
        aria-keyshortcuts={hasFeather || !editor.settings.letterKeys ? undefined : 'F'}
        title={hasFeather ? t('editor.fullscreen') : editor.keyHint(t('editor.fullscreen_title'))}
        aria-label={t('editor.fullscreen')}
      >
        <Icon name="expand" />
      </button>
    {/if}
  {:else if id === 'drafts'}
    <button class="key icon" aria-haspopup="dialog" onclick={openDrafts} title={t('editor.drafts_key')} aria-label={t('editor.drafts_key')}>
      <Icon name="drafts" />
    </button>
  {:else if id === 'palette'}
    <PaletteBox {editor} />
  {:else if id === 'color'}
    <ColorPanel {editor} />
  {:else if id === 'brush'}
    <BrushPanel {editor} />
  {:else if id === 'brush-rail'}
    <BrushRail {editor} lying={railLies} />
  {:else if id === 'spring' || id === 'spring:lead'}
    <!-- Room, not a control: what stands after it stands at the far end. -->
    <span class="spring" aria-hidden="true"></span>
  {:else if id === 'brush-key'}
    <PopKey label={t('colours.brush_key')}>
      {#snippet face()}<Icon name="brush" />{/snippet}
      <BrushPanel {editor} />
    </PopKey>
  {:else if id === 'color-key'}
    <PopKey label={t('colours.key')} title={t('colours.key_title', { stroke: editor.brushColor, fill: editor.fillColor })} attrs={{ 'data-walk': '' }}>
      {#snippet face()}<span class="colour-dot" style:--swatch={editor.brushColor} style:--fill={editor.fillColor}></span>{/snippet}
      <ColoursPanel {editor} />
    </PopKey>
  {:else if id === 'brush-sizes'}
    <BrushSizes {editor} />
  {:else if id === 'timeline'}
    <div class="timeline">
      <Timeline {editor} />
    </div>
  {:else if id === 'transport'}
    <!-- One control: ⏮ ⏴ ▶ ⏵ ⏭ travel together, the way a transport reads. -->
    <div class="transport-keys" role="group" aria-label={t('editor.transport')}>
        {#if endKeys}
        <button
          class="key icon ends"
          disabled={editor.playing}
          aria-disabled={editor.activeFrame === 0 || undefined}
          onclick={() => editor.selectFrame(0)}
          title={t('editor.first_frame')}
          aria-label={t('editor.first_frame')}
        ><Icon name="frame-first" /></button>
        {/if}
        {#if stepKeys}
        <button
          class="key icon"
          disabled={editor.playing || lastFrame === 0}
          onclick={() => editor.selectFrame(wrapIndex(editor.activeFrame - 1, lastFrame + 1))}
          title={t('editor.prev_frame')}
          aria-label={t('editor.prev_frame')}
          data-name={t('editor.prev_short')}
        ><Icon name="frame-prev" /></button>
        {/if}
      <PlayControls bind:this={playControls} {editor} />
        {#if stepKeys}
        <button
          class="key icon"
          disabled={editor.playing || lastFrame === 0}
          onclick={() => editor.selectFrame(wrapIndex(editor.activeFrame + 1, lastFrame + 1))}
          title={t('editor.next_frame')}
          aria-label={t('editor.next_frame')}
          data-name={t('editor.next_short')}
        ><Icon name="frame-next" /></button>
        {/if}
        {#if endKeys}
        <button
          class="key icon ends"
          disabled={editor.playing}
          aria-disabled={editor.activeFrame >= lastFrame || undefined}
          onclick={() => editor.selectFrame(lastFrame)}
          title={t('editor.last_frame')}
          aria-label={t('editor.last_frame')}
        ><Icon name="frame-last" /></button>
        {/if}
    </div>
  {:else if id === 'add-frame'}
    <button
      class="key"
      disabled={editor.playing}
      onclick={onAddFrame}
      data-key={menuKey('add')?.label}
      aria-keyshortcuts={editor.settings.letterKeys ? 'A F7' : 'F7'}
      title={frameKeyTitle(t('editor.add_frame_title'), 'add', editor.settings.letterKeys, quickPalette)}
      aria-label={t('editor.add_frame')}
      data-name={t('editor.add_frame_short')}
    >
      <Icon name="plus" />
    </button>
  {:else if id === 'delete-frame'}
    <button
      class="key"
      disabled={editor.playing}
      aria-disabled={!editor.canRemoveFrame || undefined}
      onclick={() => editor.removeActiveFrame()}
      data-key="Del"
      aria-keyshortcuts="Delete Backspace"
      title={t('editor.delete_frame_title')}
      aria-label={t('editor.delete_frame')}
    >
      <Icon name="trash" />
    </button>
  {:else if id === 'onion'}
    <button
      class="key"
      class:active={editor.onionSkin}
      aria-pressed={editor.onionSkin}
      onclick={() => editor.toggleOnionSkin()}
      data-key={editor.keyHint('K') || undefined}
      aria-keyshortcuts={editor.settings.letterKeys ? 'K' : undefined}
      title={editor.keyHint(editor.onionSkin ? t('editor.onion_on') : t('editor.onion_off'))}
      aria-label={t('editor.onion')}
    >
      <Icon name="onion" />
    </button>
  {:else if id === 'fps'}
    <!-- The reference keeps fps on the bar itself: a slider and a box. -->
    <label class="fps-inline" title={t('editor.fps')}>
      <span class="sr-only">{t('editor.fps')}</span>
      <input
        type="range"
        min={editor.ux.fpsRange[0]}
        max={editor.ux.fpsRange[1]}
        value={editor.doc.frame_rate}
        oninput={onFpsChange}
        aria-disabled={editor.playing || undefined}
      />
      <input
        type="number"
        min={editor.ux.fpsRange[0]}
        max={editor.ux.fpsRange[1]}
        value={editor.doc.frame_rate}
        onchange={onFpsChange}
        onkeydown={leaveField}
        aria-disabled={editor.playing || undefined}
        aria-label={t('editor.fps')}
      />
    </label>
  {:else if id === 'audio'}
    <!-- The soundtrack lives behind its own key, beside layers and export:
         the wave belongs on the timeline, the file and its credits do not. -->
    <div class="layers">
      <button
        class="key"
        class:active={audioOpen}
        class:has-track={editor.audio.hasTrack}
        aria-expanded={audioOpen}
        bind:this={audioKey}
        onkeydown={escAudio}
        onclick={() => (audioOpen = !audioOpen)}
        title={editor.audio.hasTrack ? t('editor.audio_of', { name: editor.audio.name || t('editor.audio_unnamed') }) : t('editor.audio')}
        aria-label={t('editor.audio')}
      >
        <Icon name="note" />
      </button>
      {#if audioOpen}
        <AudioPanel {editor} anchor={audioKey} publishes={!!onPublish} onClose={() => (audioOpen = false)} />
      {/if}
    </div>
  {:else if id === 'export'}
    <!-- Only the key: the sheet itself stands outside the panels, so Alt+S
         opens it with the key taken off the layout or shut in «Ещё». -->
    <button
      class="key"
      aria-haspopup="dialog"
      onclick={() => exportButton?.start()}
      data-key={hasProjectFile ? undefined : 'Alt+S'}
      aria-keyshortcuts={hasProjectFile ? undefined : 'Alt+S'}
      title={hasProjectFile ? t('export.sheet') : t('export.title')}
      aria-label={t('export.sheet')}
    >
      <Icon name="download" />
    </button>
  {:else if id === 'saved'}
    <!-- One region, there before its first word: a live region inserted
         together with its text is often not announced at all. A failed save
         is urgent, so it interrupts; a saved one waits its turn. -->
    <span
      class="saved save-status {saveFailed ? 'too_big' : lastSaved ? draftSizeClass(savedBytes) : ''}"
      role={saveFailed ? 'alert' : 'status'}
    >
      <!-- Keyed by the save: in the bar over the canvas it is a note that
           shows with each one and goes by itself. -->
      {#key editor.lastSavedAt}
        {#if saveFailed}
          <b class="saved-note"><Icon name="x" size={14} /> {t('editor.save_failed')}</b>
        {:else if lastSaved}
          <b class="saved-note">{t('editor.saved_at', { when: lastSaved, size: formatFileSize(savedBytes) })}</b>
        {/if}
      {/key}
    </span>
  {:else if id === 'copy'}
    <button
      class="key icon"
      disabled={editor.playing}
      onclick={() => editor.copySelection()}
      data-key={menuKey('copy')?.label}
      aria-keyshortcuts={editor.settings.letterKeys ? 'C Control+C' : 'Control+C'}
      title={frameKeyTitle(t('editor.copy_title'), 'copy', editor.settings.letterKeys, quickPalette)}
      aria-label={t('editor.copy')}
    ><Icon name="copy" /></button>
  {:else if id === 'paste'}
    <button
      class="key icon"
      disabled={!editor.canPasteCells}
      onclick={() => editor.pasteSelection()}
      data-key={menuKey('paste')?.label}
      aria-keyshortcuts={editor.settings.letterKeys ? 'V Control+V' : 'Control+V'}
      title={frameKeyTitle(t('editor.paste_title'), 'paste', editor.settings.letterKeys, quickPalette)}
      aria-label={t('editor.paste')}
    ><Icon name="paste" /></button>
  {:else if id === 'settings'}
    <!-- Movable, never hideable: this key is the way back to the settings. -->
    <button
      class="key icon"
      aria-haspopup="dialog"
      onclick={openSettingsSheet}
      title={t('editor.settings')}
      aria-label={t('editor.settings')}
    >
      <Icon name="gear" />
    </button>
  {:else if id === 'tools'}
    <!-- The tools a phone's row had no room for, behind one key: it wears the
         one in hand, as a group of tools does. -->
    {@const held = over?.tools.map(toolOfItem).find((tool) => tool === editor.tool)}
    <PopKey label={t('editor.tools_more')} title={t('editor.tools_more')} active={!!held} shutOn={editor.tool} attrs={{ 'data-name': t('editor.tools_short') }}>
      {#snippet face()}<Icon name={held ? (toolSpec(held)?.icon ?? 'tools') : 'tools'} />{/snippet}
      <div class="more-keys tool-list">{@render slot(over?.tools ?? [])}</div>
    </PopKey>
  {:else if id === 'more'}
    <!-- A phone's one row of keys has room for a few: the rest are here. -->
    <button
      class="key icon"
      class:active={moreOpen}
      bind:this={moreKey}
      aria-expanded={moreOpen}
      aria-controls={moreOpen ? 'more-window' : undefined}
      onclick={toggleMore}
      onkeydown={onMoreKey}
      title={t('editor.more')}
      aria-label={t('editor.more')}
    >
      <Icon name="more" />
    </button>
  {:else if id === 'publish'}
    {#if onPublish}
      <!-- One key like any other: where it sits is the arrangement's business,
           not a zone fenced off in the markup. -->
      <button
        class="key primary publish"
        disabled={editor.audio.loading}
        onclick={sendOut}
        title={t('editor.publish')}
        aria-label={t('editor.publish')}
        data-name={t('editor.publish_short')}
      >
        <Icon name="send" />
      </button>
    {/if}
  {:else if id === 'merge'}
    <button
      class="key icon"
      disabled={!editor.canPasteCells}
      onclick={() => editor.mergeSelection()}
      data-key={menuKey('merge')?.label}
      aria-keyshortcuts={quickPalette ? undefined : editor.settings.letterKeys ? 'M Control+M' : 'Control+M'}
      title={frameKeyTitle(t('editor.merge_title'), 'merge', editor.settings.letterKeys, quickPalette)}
      aria-label={t('editor.merge')}
    ><Icon name="merge" /></button>
  {/if}
{/snippet}

<!-- In arrange mode every item wears a handle: the wrapper takes the pointer
     (its contents stop taking clicks) and carries the id the arranger drags. -->
{#snippet slot(items: string[])}
  {#each items as id (id)}
    {#if editor.arranging}
      <div
        class="arr"
        class:wide={panelItemSpec(id)?.wide}
        data-item={id}
        title={t('editor.drag_item', { label: panelItemSpec(id)?.label ?? id })}
      >
        <!-- Inert: Tab walked into these keys and Enter pressed them while
             every pointer on them was stopped. No box of its own. -->
        <div class="arr-body" inert use:markEmpty>{@render panelItem(id)}</div>
      </div>
    {:else}
      {@render panelItem(id)}
    {/if}
  {/each}
  {#if editor.arranging && items.length === 0}
    <span class="slot-empty">{t('editor.slot_empty')}</span>
  {/if}
{/snippet}


<!-- The words are the catalogue's, whatever language the page around them is
     in: a reader speaks them, and a hyphen breaks them, in that language. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="editor studio"
  lang={dateLocale()}
  class:alt={editor.settings.altLayout}
  class:arranging={editor.arranging}
  class:compact={compact}
  class:phone={compact}
  class:tall
  class:fingers={noHover}
  class:low={sheetScrollsWhole(viewportHeight, rootFont)}
  class:named={named && !rowPressed && (noteInPanel || noteInTop || isEmptyDocument(editor.doc))}
  data-float-root
  onpointerover={nameKey}
  onpointerout={unnameKey}
  onpointerdown={unnameKey}
  onfocusin={nameKey}
  onfocusout={unnameKey}
  bind:this={editorEl}
  onclickcapture={passFocusOnDisable}
  onpointerupcapture={fullOnFirstTouch}
  bind:clientWidth={boxW}
  bind:clientHeight={boxH}
>
  <span class="rem-probe" aria-hidden="true" bind:this={remProbe}></span>
  {#if draws(panels.top) || editor.arranging}
    <!-- The bar over the canvas (toonop: the brush and the colours, a key
         each). Drawn only when it holds something; one row on a phone. -->
    <div class="top" role="group" aria-label={t('panel.top')} data-slot="top" bind:this={topEl} onpointerdowncapture={() => (rowPressed = true)}>
      <!-- The host's bar is away on a low window (owner, 2026-10-08) and a
           desk has no «⋯»: the way back heads the row. -->
      {#if home && !compact}<a class="key" href={home.href} title={home.label} aria-label={home.label}><Icon name="chevron-left" /></a>{/if}
      {@render slot(panels.top)}
      {#if noteDue && noteInTop}<div class="top-note">{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}</div>{/if}
    </div>
  {/if}
  {#if sideDraws('left') || editor.arranging}
    <aside
      class="left"
      class:collapsed={folded('left')}
      aria-label={t('editor.tools_side')}
      data-slot="left"
      data-folded={folded('left') ? '' : undefined}
      data-over-sheet={folded('left') || (compact && !railLies) ? undefined : ''}
      class:at-left={atLeft('left')}
      class:sidebar={sideFixed('left')}
      class:lies={railLies}
      style={sideStyle('left')}
      style:--stage-h={compact ? `${stageHeight}px` : undefined}
      bind:clientWidth={sidePx.left}
      bind:clientHeight={sideH.left}
    >
      {#if !folded('left')}
        {@render slot(panels.left)}
      {/if}
    </aside>
    {#if !sideFixed('left')}
      {@render sideEdge('left', t('editor.tools_side'))}
    {/if}
  {/if}
  <div class="stage" data-slot="float" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight} class:narrow={stageWidth < 44 * rem} class:zoom-corner={(compact && !scaleUnder) || railLies}
    style:--scale-left={scaleUnder ? `${-sidePx[scaleUnder]}px` : undefined}
    style:--stage-left={sideTrack(sideAt(true)) ? `${sideTrack(sideAt(true))}px` : undefined}
    style:--stage-right={sideTrack(sideAt(false)) ? `${sideTrack(sideAt(false))}px` : undefined}
    style:--stage-under={!panelFolded && !barBare && panels.rows.length > 0 ? `${panelBoxH + 1.2 * rem}px` : undefined}>
    <CanvasView {editor} rail={stageRail} />
    <!-- The host's note speaks of an empty sheet: not over a drawing, not
         under the hub — and not under a phone's «⋯» window either. Nor under
         the first visit's presets, which stand in the same place. -->
    {#if noteDue && !noteInPanel && !noteInTop && !editor.presetAsk && !(compact && !isEmptyDocument(editor.doc))}{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}{/if}
    <!-- The reference's two floating tool windows: the transform fields while
         a selection is live, the zoom window while the hand is up. They sit
         over the canvas, not in the tool rail, which is only 8.4rem wide. -->
    {#if editor.transform || pipetteUp || editor.pluginWindow}
      <!-- Raised by the press or the focus, as a floating window is. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tool-windows" style:z-index={editor.toolsOnTop ? 'calc(var(--z-float) + 4)' : undefined} onpointerdowncapture={raiseTools} onfocusin={raiseTools}>
        {#if editor.pluginWindow}
          <!-- A window a tool brought with it: the editor draws the frame and
               the title, the tool fills the body with whatever it likes. -->
          <div class="pick-window" role="group" aria-label={editor.pluginWindow.title}>
            <p class="pick-title">{editor.pluginWindow.title}</p>
            <div bind:this={pluginSlot}></div>
          </div>
        {/if}
        {#if editor.transform}
          <TransformMenu {editor} />
        {/if}
        {#if pipetteUp}
          <!-- Where the pipette reads from. It comes up with the pipette and
               goes with it, like the zoom window with the hand: on a panel it
               was a pair of keys sitting dead most of the time. -->
          <div class="pick-window" role="group" aria-label={t('editor.pick_source')}>
            <p class="pick-title">{t('editor.pipette')}</p>
            <div class="pick-source">
              {#each [['canvas', t('editor.pick_canvas')], ['layer', t('editor.pick_layer')]] as [source, label] (source)}
                <button
                  class="key"
                  class:active={editor.pickSource === source}
                  aria-pressed={editor.pickSource === source}
                  onclick={() => editor.setPickSource(source as 'canvas' | 'layer')}
                  title={source === 'canvas'
                    ? t('editor.pick_canvas_title')
                    : t('editor.pick_layer_title')}
                >{label}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
    <!-- The only zoom control there is, so it is always on the canvas: in the
         far corner, faded back until the hand is up, the wheel turns, or it is
         hovered or focused. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scale-window" data-over-sheet={compact ? undefined : 'beside'} style:z-index={editor.toolsOnTop ? 'calc(var(--z-float) + 4)' : undefined} onpointerdowncapture={raiseTools} onfocusin={raiseTools}>
      <ScaleMenu {editor} />
    </div>
    {#if flashVisible}
      <div class="flash" aria-hidden="true"></div>
    {/if}
    <!-- Modes that change what a press does or where the drawing lives. The
         region is always there, so its first words are announced. -->
    <div class="stage-notes" role="status">
      {#if storageBlocked}
        <p class="stage-note">{t('editor.save_unavailable')}</p>
      {/if}
      {#if clipNote}
        <p class="stage-note" class:sr-only={!clipShown}>{clipNote}</p>
      {/if}
    </div>
    <!-- A first visit: which studio to draw in. Pressed, a preset lays the
         panels out at once — the studio is its own preview. Nothing waits on
         it: the sheet under it draws, and the first line takes it away. -->
    {#if editor.presetAsk && noteDue && !editor.arranging}
      <section class="preset-ask" aria-labelledby="preset-ask-title">
        <div class="preset-ask-head">
          <h2 id="preset-ask-title">{t('intro.title')}</h2>
          <button class="preset-ask-close" aria-label={t('picker.close')} onclick={() => editor.closePresetAsk()}><Icon name="x" size={16} /></button>
        </div>
        <div class="preset-ask-chips">
          {#each presets() as p (p.id)}
            <button aria-pressed={editor.preset === p.id} onclick={() => editor.applyPreset(p.id)}>
              <b>{p.label}</b>
              <span>{t('intro.tools', { count: presetUx(p.id).tools.length })}</span>
            </button>
          {/each}
        </div>
        <p>{t('intro.later')}</p>
      </section>
    {/if}
    {#if over && moreOpen}
      <!-- What a phone's row of keys has no room for, each key by its name. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <section
        id="more-window"
        class="more-window"
        tabindex="-1"
        aria-label={t('editor.more')}
        bind:this={tabWindow}
        onkeydown={onMoreKey}
        onclickcapture={shutMoreForSheet}
      >
        {#each over.more as group (group.id)}
          <h2 class="more-title">{t(`editor.more_group.${group.id}`)}</h2>
          <div class="more-keys" role="group" aria-label={t(`editor.more_group.${group.id}`)}>
            {@render slot(group.items)}
            <!-- Lying down the host has put its header away to give the sheet
                 the height (owner, 2026-10-08): its way back stands here. -->
            {#if group.id === 'studio' && home}<a class="key" href={home.href} aria-label={home.label}><Icon name="chevron-left" /></a>{/if}
          </div>
        {/each}
      </section>
    {/if}
    <p class="key-name" popover="manual" aria-hidden="true" class:shown={keyName} class:over={keyName?.over} style:--y="{keyName?.y ?? 0}px" bind:this={keyNameEl}>{keyName?.text ?? ''}</p>
    <p class="import-error drop-note" class:shown={dropNote} popover="manual" role="status" bind:this={dropNoteEl}>
      {dropNote ? t('editor.drop_sheet_open') : ''}
    </p>
    {#if importError}
      <p class="import-error" role="alert">
        {importError}
        <button class="key" onclick={dismissImportError} aria-label={t('editor.close_message')}>
          <Icon name="x" size={16} />
        </button>
      </p>
    {/if}
  </div>
  {#if sideDraws('right') || editor.arranging}
    <aside
      class="right"
      class:collapsed={folded('right')}
      aria-label={t('editor.palette_side')}
      data-slot="right"
      data-folded={folded('right') ? '' : undefined}
      data-over-sheet={folded('right') ? undefined : ''}
      class:at-left={atLeft('right')}
      style={sideStyle('right')}
      bind:clientWidth={sidePx.right}
      bind:clientHeight={sideH.right}
    >
      {#if !folded('right')}
        {@render slot(panels.right)}
      {/if}
    </aside>
    {@render sideEdge('right', t('editor.palette_side'))}
  {/if}
  <!-- A panel with nothing in it is not drawn — the canvas takes the room. -->
  {#if panels.rows.length > 0 || editor.arranging}
  <div
    class="panel"
    data-over-sheet={panelFolded ? undefined : ''}
    bind:offsetHeight={panelBoxH}
    class:collapsed={panelFolded}
    class:bare={barBare}
    class:boxed={boxExtra > 0}
    data-slot={panelFolded && editor.arranging ? `row:${Math.max(0, panels.rows.length - 1)}` : undefined}
    data-folded={panelFolded && editor.arranging ? '' : undefined}
    class:dragging={resize?.side === 'panel'}
    style={!panelFolded && !compact && !editor.arranging ? `height: ${panelHeight}px` : undefined}
  >
    <!-- The bar folds like the columns do: the same key-shaped tab, lying on
           its side at the corner of its seam. -->
      <button
        class="fold lying"
        onclick={() => (compact ? (stripShut = !stripFolded) : editor.togglePanel())}
        aria-expanded={!barFolded}
        title={barFolded ? t('editor.panel_expand') : t('editor.panel_fold')}
        aria-label={barFolded ? t('editor.bottom_expand') : t('editor.bottom_fold')}
      >
        <Icon name={barFolded ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
    {#if !barFolded && !compact}
      <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
           svelte-check's non-interactive rules do not model. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="resizer"
        role="separator"
        aria-label={t('editor.bottom_height')}
        aria-orientation="horizontal"
        aria-valuenow={panelHeight}
        aria-valuemin={panelLow}
        aria-valuemax={panelMax}
        tabindex="0"
        onpointerdown={(e) =>
          startResize(e, 'y', -1, panelHeight, (px, persist) => editor.setPanelHeight(px, persist), 'panel', panelMax)}
        onkeydown={onDividerKey}
        title={t('editor.bottom_height_title')}
      ></div>
    {/if}
    {#if noteDue && noteInPanel}<div class="panel-note">{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}</div>{/if}
    {#if !panelFolded}
      <!-- However many rows the arrangement has, top to bottom. A row that
           empties is gone (panels.ts), so no unreachable strip is left; a new
           row is made by dragging past a row's top or bottom edge, so nothing
           has to stand there holding a place open. -->
      <div class="toolbar">
        {#each panels.rows as row, i (i)}
          <!-- A phone folds the strip alone: the transport's row stays. -->
          {#if !(stripFolded && row.includes('timeline'))}
          <div
            class="row"
            role="group"
            aria-label={t('editor.row_n', { n: i + 1 })}
            data-slot="row:{i}"
            class:strip-row={row.includes('timeline')}
            bind:contentRect={rowBoxes[i]}
          >
            {@render slot(row)}
          </div>
          {/if}
        {/each}
        {#if editor.arranging && panels.rows.length === 0}
          <!-- Every row gone, the bar had nothing to drop on: only «Сбросить»
               brought it back. A drop here makes the first row. -->
          <div class="row" data-slot="newrow:0">{@render slot([])}</div>
        {/if}
      </div>
    {/if}
  </div>
  {/if}

  <!-- Items taken off the panels: windows over the whole editor — the canvas
       and the panels alike — so folding a column never moves them. In a fixed
       order: the stack is their z-index, and a node moved to the top lost
       the focus and the pointer in it. -->
  {#each [...panels.float].sort() as id (id)}
    <!-- As a column: a window whose item the profile does not draw (the
         pipette's key once the palette is folded) stood as an empty frame. -->
    {#if draws([id])}
      <FloatWindow {editor} {id}>
        {@render panelItem(id)}
      </FloatWindow>
    {/if}
  {/each}

  {#if editor.arranging}
    <PanelArranger {editor} />
  {/if}

  {#if draftsOpen}
    <DraftsHub
      bind:this={hub}
      {editor}
      {compact}
      {drafts}
      {thumbUrls}
      {storageUsed}
      {draftId}
      {home}
      create={createOnOpen}
      ready={draftsRead}
      onOpen={openDraft}
      onCopy={copyDrafts}
      onDownload={downloadDrafts}
      onRemove={removeDrafts}
      onRemoveAll={removeAllDrafts}
      onSheet={startSheet}
      onClose={() => {
        draftsOpen = false;
        createOnOpen = false;
        hubFromStudio = false;
        // Esc and a card opened both left the focus on <body>: it goes back
        // to the key the hub was called from, once the studio is live again.
        const back = hubFrom;
        hubFrom = null;
        void tick().then(() => {
          if (back instanceof HTMLElement && back.isConnected && document.activeElement === document.body) {
            back.focus();
          }
        });
      }}
    />
  {/if}

  {#if settingsSheetOpen}
    <SettingsSheet
      {editor}
      {compact}
      onClose={() => (settingsSheetOpen = false)}
      onDownloadErrors={downloadErrorLog}
      onOpenFile={() => fileInput?.click()}
      onOpenDrafts={openDrafts}
      onOpenPlugins={() => (pluginsSheetOpen = true)}
    />
  {/if}

  {#if pluginsSheetOpen}
    <PluginsSheet {editor} onClose={() => (pluginsSheetOpen = false)} />
  {/if}

  <!-- Always here, whatever the panels hold: Alt+S is the export's own key. -->
  <ExportSheet
    bind:this={exportButton}
    {editor}
    onPublish={onPublish ? sendOut : undefined}
    onOpen={() => {
      editor.commitTransform(); // under the lock too (owner, 16th audit)
      saveNow();
    }}
  />

  <!-- Space's own player while no transport is drawn, as the export sheet
       above is Alt+S's: not shown, not focusable, only there to be toggled. -->
  {#if !transportDrawn}
    <div hidden><PlayControls bind:this={playControls} {editor} /></div>
  {/if}

  <!-- The lock: an update is coming down, and nothing else is to be touched
       while it does. Esc does not call it off — there is nothing to call off. -->
  <dialog class="updating" bind:this={updatingEl} aria-labelledby="editor-updating" oncancel={(e) => e.preventDefault()}
    onclose={() => editor.updating && updatingEl?.showModal()}>
    <p id="editor-updating">{t('editor.plugins_updating')}</p>
  </dialog>

  <!-- Customization sheet: roomy, one concern per row, big tap targets. -->
  <!-- (SHORTCUTS is declared in the script block above.) -->
  {#if manualOpen}
    <dialog
      bind:this={manualDialog}
      class="sheet sheet-dialog"
      aria-label={t('editor.manual')}
      onclose={() => (manualOpen = false)}
    >
      <header class="sheet-head">
        <h2>{t('editor.manual')}</h2>
        <button class="key icon" onclick={() => manualDialog?.close()} aria-label={t('editor.close')}>
          <Icon name="x" />
        </button>
      </header>

      <!-- Nothing inside takes focus, so the body itself does: otherwise the
           arrow keys have nowhere to scroll the list from. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="sheet-body" tabindex="0">
        <!-- Every shortcut the key handler above actually implements, in one
             place. They were reachable but undocumented: nothing in the UI said
             the editor had any. Behind the sheet, so the toolbar stays quiet. -->
        {#snippet keyList()}
          <p class="sheet-hint">{t('editor.shortcuts')}</p>
          <dl class="keylist">
            {#each SHORTCUTS as [combo, what] (combo)}
              <div class="keyrow">
                <dt><kbd>{combo}</kbd></dt>
                <dd>{what}</dd>
              </div>
            {/each}
          </dl>
        {/snippet}
        {#snippet gestureList()}
          <p class="sheet-hint">{t('editor.gestures')}</p>
          <dl class="keylist gestures">
            {#each GESTURES as id (id)}
              <div class="keyrow">
                <dt>{t(`gesture.${id}`)}</dt>
                <dd>{t(`gesture_does.${id}`)}</dd>
              </div>
            {/each}
          </dl>
        {/snippet}
        {@render (touchFirst ? gestureList : keyList)()}
        {#if !fingersOnly}{@render (touchFirst ? keyList : gestureList)()}{/if}
      </div>

      <footer class="sheet-foot">
        <button class="key primary" onclick={() => manualDialog?.close()}>{t('editor.done')}</button>
      </footer>
    </dialog>
  {/if}

  {#if question}
    <!-- Esc and «Отмена» are a no; the form's submit is the yes, so Enter in
         the name field saves. The message names the dialog: it is the whole
         of what is asked. -->
    <dialog
      bind:this={questionDialog}
      class="sheet sheet-dialog ask"
      aria-labelledby="ask-text"
      onclose={() => answer(false)}
    >
      <form onsubmit={(e) => { e.preventDefault(); answer(true); }}>
        <div class="sheet-body">
          <p id="ask-text">{question.message}</p>
          {#if question.kind === 'text'}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="ask-name" type="text" autocomplete="off" aria-labelledby="ask-text" autofocus bind:value={question.value} />
          {/if}
        </div>
        <footer class="sheet-foot">
          <button class="key primary" type="submit">{question.yes}</button>
          {#if question.kind !== 'tell'}
            <!-- svelte-ignore a11y_autofocus -->
            <button class="key" type="button" autofocus={question.final} onclick={() => answer(false)}>{t('ask.no')}</button>
          {/if}
        </footer>
      </form>
    </dialog>
  {/if}

  {#if megaWarnOpen}
    <dialog
      bind:this={megaWarnDialog}
      class="sheet sheet-dialog"
      aria-labelledby="mega-warn-title"
      aria-describedby="mega-warn-text"
      onclose={() => (megaWarnOpen = false)}
    >
      <header class="sheet-head">
        <h2 id="mega-warn-title">{t('editor.mega_eraser_title')}</h2>
        <button class="key icon" onclick={() => megaWarnDialog?.close()} aria-label={t('editor.close')}>
          <Icon name="x" />
        </button>
      </header>
      <div class="sheet-body">
        <p id="mega-warn-text">{MEGA_ERASER_WARNING}{#if megaDraftSaved}{' '}{t('editor.mega_eraser_saved')}{/if}</p>
        <label class="mute-warning">
          <input
            type="checkbox"
            checked={!editor.settings.megaEraserWarning}
            onchange={(e) => editor.setSetting('megaEraserWarning', !e.currentTarget.checked)}
          />
          {t('editor.dont_show_again')}
        </label>
      </div>
      <footer class="sheet-foot">
        <button class="key primary" onclick={() => megaWarnDialog?.close()}>{t('editor.got_it')}</button>
      </footer>
    </dialog>
  {/if}
</div>

<style>
  /* The brand table (ink / paper / canvas / signal / accent) comes from
     `tokens.css`, imported above: one file, read by the editor and by the site
     that embeds it. What is left here is the editor's own chrome — the
     worktable tone, the key height, the bleed — which no other surface has.
     Declared on `.editor` so every child inherits through the DOM; scoped
     styles still resolve `var(--…)` at runtime. */
  .editor {
    /* The z ladder in tokens.css is one context, and this is it: without it
       the timeline head (z 1) painted over the host page's publish message. */
    isolation: isolate;
    /* The worktable: one tonal step under the chrome, same blue bias. Four
       surfaces read apart without a single extra line — panels on paper, the
       drawing on white, the table between them. */
    --table: #d7dfee;
    /* Layer tags: six hues cycling by row position, a display aid only — the
       document stores no colour. Kept muted so a column of them reads as
       stripes beside the names rather than competing with the drawing. Six
       hues, none of them in the signal band: The Signal Rule reserves red for
       «рисовать» and names icons and borders as off-limits, and the written
       carve-out in DESIGN §2 covers paint inside a drawing (the mascot), not
       interface chrome. The fourth was #c0392b, 6° from the signal. Each tag
       is a button, so it holds 3:1 (WCAG 1.4.11) on the paper and on the
       active row: the second and third were #00997a and #b8860b, 2.6 and 2.4
       on the active row, now the same hues darkened. */
    --layer-tag-0: var(--electric);
    --layer-tag-1: #008a6e;
    --layer-tag-2: #9e7309;
    --layer-tag-3: #c2185b;
    --layer-tag-4: #7d3cc7;
    --layer-tag-5: #0f7d9e;
    /* The copy/paste flash over the canvas: the reference's 0xCCCCCC at 0.9,
       kept to the value because parity is the point of it. */
    --flash: #cccccce6;
    /* WCAG/DESIGN tap floor — every key is at least 44x44. */
    --key-h: 2.75rem;
    /* The same floor where a control must not grow with the text: the
       small screen's tabs share one row whatever the text size. */
    --tap: 44px;
    /* How far a control paints outside its own box: the focus ring (3px at
       2px offset) is the widest, then the active swatch's 2px ring and the
       key's 2px shadow. Anything that scrolls has to leave this much room,
       or it shaves those off at its edge. */
    --bleed: 6px;

    /* Frame for the floating windows: they live over the whole editor, not
       over the canvas, so folding a column does not move them. */
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    /* `viewport-fit=cover` hands the page the whole glass: on a phone lying
       down the pencil sat under the notch. Zero everywhere else. */
    box-sizing: border-box;
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
    color: var(--text);
    font-family: var(--font-body);
    /* Reference .draw: nothing here is prose, so a drag across the chrome —
       the panel resizer above all — never leaves a blue smear behind. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  /* The fields you do type in keep their selection. */
  .editor input {
    user-select: text;
    -webkit-user-select: text;
  }
  /* Paper worktable so the white sheet floats on brand tone, not a bare
     letterbox. No padding: the table runs to the bars, and the air around the
     sheet is the fit's own margin — otherwise a magnified sheet reads as cut
     off by a grey frame. */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--table);
    box-sizing: border-box;
  }
  .tool-windows {
    position: absolute;
    left: clamp(0.5rem, 2.2vw, 1.25rem);
    top: clamp(0.5rem, 2.2vw, 1.25rem);
    z-index: var(--z-tool);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 13rem;
    /* Ends above the zoom window in the same corner column (its keys and 2px
       inset): a tall transform window ran under it at large text. */
    max-height: calc(100% - 3 * clamp(0.5rem, 2.2vw, 1.25rem) - var(--key-h, 2.75rem) - 4px);
    overflow-y: auto;
  }
  .scale-window {
    position: absolute;
    /* Under the left column, where there is room for it (`--scale-left`,
       set by the stage): in line with the column's own edge. */
    left: var(--scale-left, clamp(0.5rem, 2.2vw, 1.25rem));
    bottom: clamp(0.5rem, 2.2vw, 1.25rem);
    z-index: var(--z-tool);
    /* One row of keys — it takes the width it needs, not a panel's. */
    width: max-content;
  }
  /* A phone with no room for it under the sidebar: beside the sidebar it
     took its whole column off the sheet's fit — a 97 px sheet on 360×640. In
     the far top corner it costs the sheet one row, or lying down one corner.
     Its keys on the tap floor and the window no wider than the stage: at
     200 % text it was 293 px on a 240 px stage. */
  .stage.zoom-corner {
    --zoom-inset: clamp(0.5rem, 2.2vw, 1.25rem);
    /* Where the window ends — its inset, a key and its 2px frame, a gap: the
       host's note on the stage starts under it. */
    --zoom-foot: calc(var(--zoom-inset) + var(--tap) + 4px + 0.5rem);
  }
  /* A first visit: the row's names hang 0.5rem + 3px under the bar, a label
     tall (`.studio.compact.named .top .key::after`), and the window stood in
     the same corner 0.5rem under it — the names lay on its keys. It stands
     under them while they are worn; the sheet is not fitted by it on a phone
     and does not move. */
  .studio.compact.named .stage.zoom-corner {
    --zoom-inset: calc(0.5rem + 3px + 0.7rem + 0.4rem);
  }
  .stage.zoom-corner > .scale-window {
    --key-h: var(--tap);
    inset: var(--zoom-inset) var(--zoom-inset) auto auto;
    max-width: calc(100% - 2 * var(--zoom-inset));
  }
  .stage.zoom-corner > .scale-window :global(.value) {
    min-width: 0;
  }
  /* The canvas's hint, in the middle of the stage's foot, lay over the zoom
     window in its corner on a narrow stage (audit 17). On the desk it keeps
     to the gap between that window and its mirror (its inset, two keys, the
     readout, a gap)… */
  .studio .stage :global(.hint) {
    max-width: calc(100% - 2 * (clamp(0.5rem, 2.2vw, 1.25rem) + 2 * var(--key-h, 2.75rem) + 3.4rem + 1rem));
  }
  /* …and where that gap is too narrow for a sentence, rises above its row.
     By a measured class, not a container query: a query container is layout
     containment in Safari before 18.4 — the stage became the block every
     `position: fixed` in it is placed against (the brush ring, a tool window
     being dragged) and a stacking context of its own. */
  .studio .stage.narrow :global(.hint) {
    max-width: calc(100% - 24px);
    bottom: calc(var(--stage-under, 0px) + clamp(0.5rem, 2.2vw, 1.25rem) + var(--key-h, 2.75rem) + 4px + 0.5rem);
  }
  /* Quiet at rest is the window's own business now (ScaleMenu.svelte): it is
     the fill that steps back, not the window, so the readout and the edge keep
     their contrast while the hand is down. */
  /* Copy/paste flash — the reference's 0xCCCCCC @ 0.9 fadeSprite. The value is
     parity and cannot move; what it can do is be declared, like the worktable
     and the layer tags above, so the table knows about it. */
  .flash {
    position: absolute;
    inset: 0;
    z-index: var(--z-flash);
    background: var(--flash);
    pointer-events: none;
  }
  /* Bottom toolbar — the second neutral layer over the white canvas. */
  .panel {
    flex: none;
    box-sizing: border-box;
    background: var(--paper);
    border-top: 1px solid var(--hairline);
    padding: 0.6rem 0.9rem;
    /* A phone lying down is wider than the phone branch, and its home
       indicator sat over the strip's last row. */
    padding-bottom: max(0.6rem, env(safe-area-inset-bottom));
  }
  .studio .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    /* The divider owns the height: the strip scrolls its layers inside it and
       a row too tall for it scrolls too, rather than growing the panel over
       the canvas or past the bottom of the window. `clip` with a margin so a
       key's shadow is not shaved off at the edge — and so the furniture that
       straddles the seam on purpose survives it: the drag band 8px above the
       edge and the fold tab 15px above it, plus that tab's focus ring (3px
       at 2px offset) and the 1px the tab lifts under the cursor. The margin is
       uniform, so it is the tallest of them: the tab (its 14px arrow in rem
       and a pixel) + 3 + 2 + 1 — 21 at 100 % text, 35 at 200 %. In rem, not
       px, or the grown tab is cut at 200 %; and a bare length, because
       Chromium drops the whole declaration when it is a calc(): 1.3125rem is
       the 21 exactly at 100 % and 42 — past the 35 — at 200 %. */
    max-height: 75dvh;
    overflow: clip;
    overflow-clip-margin: 1.3125rem;
  }
  /* Reference #resizer: a 16px band straddling the panel's top edge, so the
     grab target is not the 1px border. (`.divider` is taken — it is the hair
     rule inside the settings popover.) */
  .resizer {
    position: absolute;
    top: -8px;
    /* The straight part of the card's edge, as the columns' seam. */
    left: var(--r-lg);
    width: calc(100% - 2 * var(--r-lg));
    height: 16px;
    cursor: ns-resize;
    touch-action: none;
  }
  /* Same seam language as the columns: drawn only while it is in use. */
  .panel.dragging .resizer {
    background: linear-gradient(var(--accent), var(--accent)) center / 100% 2px no-repeat;
  }
  @media (hover: hover) {
    .resizer:hover {
      background: linear-gradient(var(--accent), var(--accent)) center / 100% 2px no-repeat;
    }
  }
  .resizer:focus-visible {
    outline: none;
    background: linear-gradient(var(--accent), var(--accent)) center / 100% 3px no-repeat;
  }
  /* The bar's own tab: the side tab turned on its side, at the corner of the
     seam where the tools column ends. */
  .fold.lying {
    top: auto;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: var(--key-h);
    height: calc(0.875rem + 1px);
    border-bottom: none;
    border-radius: var(--r-sm) var(--r-sm) 0 0;
    box-shadow: none;
  }
  @media (hover: hover) {
    .fold.lying:hover {
      transform: translate(-50%, -1px);
    }
  }
  .fold.lying:active {
    transform: translateX(-50%);
  }
  /* Folded, the bar is its tab alone. */
  .studio .panel.collapsed {
    /* Folded, only its tab is left (owner, 2026-10-06): no strip across the
       studio — the canvas runs to the edge, the tab stands on it. */
    height: 0;
    padding: 0;
    border: none;
    background: none;
  }
  .panel.collapsed .fold,
  .panel.bare .fold,
  .side-edge.folded .fold {
    background: color-mix(in srgb, var(--canvas) 55%, transparent);
  }
  .panel.collapsed .fold:focus-visible,
  .side-edge.folded .fold:focus-visible {
    background: var(--sub);
  }
  @media (hover: hover) {
    .panel.collapsed .fold:hover,
    .side-edge.folded .fold:hover {
      background: var(--sub);
    }
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .studio .toolbar {
    /* The rows scroll when they have to, and a scroll box clips at its own
       padding edge — which shaved the electric ring and the drop shadow off
       the keys and swatches sitting against it. The padding gives that paint
       its room; the negative margin puts the rows back where they were. */
    overflow-y: auto;
    padding: var(--bleed);
    margin: calc(-1 * var(--bleed));
  }
  /* The timeline is the row that takes the height the divider hands out. */
  .studio .toolbar {
    flex: 1;
    min-height: 0;
  }
  /* The strip is the row that takes the height the divider hands out — the
     row it is in, not a fixed one: it can be moved. */
  .studio .row.strip-row {
    flex: 1;
    min-height: 0;
    /* The strip is a tall grid, so the keys beside it sit at its top rather
       than floating in the middle of it — the strip itself stretches. */
    align-items: flex-start;
  }
  /* A box in the bar (the palette, the brush) with the canvas at its floor:
     the rows scroll, the strip is not the one squeezed to nothing. Its height
     under the bar's own floor, one row of keys over it. */
  .studio .panel.boxed .row.strip-row {
    min-height: 4.875rem;
  }
  .studio .row.strip-row > .timeline,
  .studio .row.strip-row > .arr[data-item='timeline'] {
    align-self: stretch;
    min-height: 0;
  }
  .studio .timeline {
    height: 100%;
    min-height: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    /* The rows hold whatever the config puts in them, so a full one wraps
       rather than widening the page into a horizontal scroll. */
    flex-wrap: wrap;
  }
  /* ---- Arrange mode ----
     Every item becomes a handle: a dashed box that takes the pointer, with
     its contents frozen underneath so a drag never presses a button. */
  .editor.arranging .arr {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 2px;
    /* The handle is the item plus 2px, centred in whatever cell it lands in:
       stretched, it stood off the key by the cell's spare width and height
       instead of framing it. */
    place-self: center;
    /* The frame goes round the key, not across it: the padding box is the
       key plus 2px, and the radius follows it, so the corners clear the
       key's own 7px ones. */
    border-radius: calc(var(--r-sm) + 2px);
    outline: 2px dashed var(--accent);
    cursor: grab;
    touch-action: none;
  }
  /* In a row that scrolls (the tool row on a phone) a handle keeps its
     key's width: shrunk, thirteen handles overlapped in 390px. */
  .editor.arranging .arr:not(.wide) {
    flex-shrink: 0;
  }
  /* Whatever takes the whole row — the strip, the palette box — still does. */
  .editor.arranging .arr.wide {
    place-self: stretch;
    /* «Сохранено» before the first save is empty: its handle was a 4px
       sliver no hand could take — across in a row, and down in a column,
       where it is stretched to the column's width. */
    min-width: var(--key-h);
  }
  /* The floor down is a strut, not a `min-height`: a written one replaces the
     automatic minimum, and a column's grid then shrank the brush handle's row
     to what the column had left, with the box hanging out over the palette. */
  .editor.arranging .arr.wide::before {
    content: '';
    flex: none;
    height: var(--key-h);
    /* Takes back the handle's gap, so the contents stay on the frame. */
    margin-inline-end: -0.3rem;
  }
  .editor.arranging .arr-body {
    display: contents;
  }
  .editor.arranging .arr-body > :global(*) {
    pointer-events: none;
    /* The item grows into the whole handle, so the frame keeps its 2px on
       every side where the grid cell is wider than the key — from its own
       width, never below it, or the bar's keys lose their square. Its shadow
       goes with it: nothing is pressed while things are being moved, and the
       2px under the key read as a tighter gap there than at the top. */
    flex: 1 1 auto;
    box-shadow: none;
  }
  .editor.arranging :global([data-slot]) {
    outline: 1px dashed var(--hairline);
    outline-offset: -1px;
  }
  /* A key the profile does not draw leaves an empty handle behind; there is
     nothing to grab, so there is nothing to show. */
  .editor.arranging .arr:global([data-empty]) {
    display: none;
  }
  /* The bar sizes to its contents while things are being moved into it. */
  .editor.arranging .panel {
    max-height: 60dvh;
  }
  /* Folded, it still takes a drop (owner, 19th audit): a strip to aim at. */
  .editor.arranging .panel.collapsed {
    height: var(--key-h);
  }
  .editor.arranging .slot-empty {
    padding: 0 0.4rem;
    min-height: var(--key-h);
    display: inline-flex;
    align-items: center;
    color: var(--ink-2);
    font-size: 0.82rem;
  }
  /* A column with nothing in it still has to be a target one can hit. */
  .editor.arranging .left,
  .editor.arranging .right {
    min-width: 4rem;
  }
  /* A panel that scrolls keeps scrolling under a finger while arranging: its
     handles fill it, and with `touch-action: none` on each a key past the
     edge could never be reached. A swipe along the panel scrolls it; a drag
     across it — out, which is where every item goes — picks the item up.
     (A small screen does not arrange: only its tabs move.) */
  .editor.arranging .left .arr,
  .editor.arranging .right .arr {
    touch-action: pan-y;
  }
  /* The transport is one control: its keys keep the row's own spacing so
     nothing reads as a seam between them. */
  .transport-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  /* The pipette's source pair, in a tool window of the same make as the
     zoom one (ScaleMenu). */
  .pick-window {
    padding: 0.5rem;
    border: none;
    border-radius: var(--r-md);
    background: var(--canvas);
    font-size: 0.8125rem;
  }
  .pick-title {
    margin: 0 0 0.4rem;
    font-weight: 600;
  }
  .pick-source {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pick-source button {
    flex: 1;
    padding: 0 10px;
    font-size: 0.8125rem;
  }
  /* Undo/redo (and whatever else the config puts beside them) stay a row —
     the studio column turns this into a grid below. */
  .history {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  /* The sound's key with a track attached: with one and without it looked the
     same, and only its title knew. The accent's ink, as a chosen key's icon. */
  .layers > .key.has-track {
    color: var(--accent-ink);
  }
  .timeline {
    flex: 1;
    min-width: 0;
  }
  /* The timeline's scroll arrows are a mouse affordance: a small screen
     swipes the strip and Tab walks the frames, so they give their 88px back to
     the thumbnails. Both classes, to outrank the shared .key vocabulary below. */
  .editor.compact :global(.arrow.key) {
    display: none;
  }
  /* ---- Studio layout (toonio.ru editor.html) ----
     tools | canvas | panels, the bar under all three. The bar keeps its own
     rows; only the draw row moves out to the sides. */
  .editor.studio {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--paper);
  }
  /* Every area names its row as well as its column: grid auto-placement never
     goes backwards, so under `.alt` — where .left sits right of .right — an
     unpinned row would push each following area onto a new one. */
  .studio .stage {
    grid-column: 2;
    grid-row: 1;
    /* A 1fr track still refuses to go under its content's min width, and the
       canvas is as wide as the drawing: without this the side columns get
       squeezed, or pushed off the screen, instead of the canvas re-fitting. */
    min-width: 0;
  }
  .studio .panel {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  /* The columns float as the bar under the canvas does (owner, 2026-10-05):
     a card as tall as what is in it, the table at its outer edge, the canvas
     running on under it (CanvasView `--stage-left`, `--stage-right`) and the
     sheet fitted clear of it (`data-over-sheet`). Over the canvas by its
     layer: the canvas is positioned and would lie on a column that is not.
     Folded, a column is its tab alone. */
  .studio .left,
  .studio .right {
    position: relative;
    z-index: 1;
  }
  .studio .left:not(.collapsed),
  .studio .right:not(.collapsed) {
    align-self: start;
    max-height: calc(100% - 1.2rem);
    margin: 0.6rem 0.6rem 0.6rem 0;
    border-radius: var(--r-lg);
  }
  .studio .left.at-left:not(.collapsed),
  .studio .right.at-left:not(.collapsed) {
    margin: 0.6rem 0 0.6rem 0.6rem;
  }
  /* The boxes' column, packed closer for the same reason as the brush box
     in it (BrushPanel): the palette and the brush fit a desk screen's height
     without the column scrolling. */
  .studio .right:not(.collapsed) {
    padding-block: 0.6rem;
    gap: 0.4rem;
  }
  /* A profile's fixed sidebar (toonop): one key wide, its keys one under
     another — the thickness, then undo over redo. 3.95rem is SIDEBAR_REM. */
  /* In the middle of the stage's height, as Procreate's sliders stand: under
     the thumb of the hand that holds the phone — and on the desktop as well
     (owner, 2026-10-07). */
  .studio .left.sidebar {
    width: 3.95rem;
    padding: 0.6rem;
    grid-template-columns: 1fr;
    align-self: center;
  }
  .studio .left.sidebar .history {
    grid-template-columns: 1fr;
  }
  /* The widget lying (a screen standing up): across the stage's row, at its
     foot, in the middle — over the canvas like any card, in no column. One
     line: the number, the slider, undo, redo. */
  .studio .left.sidebar.lies {
    grid-column: 1 / -1;
    grid-row: 1;
    align-self: end;
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: auto;
    max-width: calc(100% - 1.2rem);
    margin: 0 0 0.6rem;
    padding: 0.4rem 0.6rem;
  }
  .studio .left.sidebar.lies .history {
    /* Two keys whole: the slider gives way, not they. */
    flex: none;
    grid-template-columns: repeat(2, var(--key-h));
  }
  /* A phone's keys stand on the tap floor, not on the text size: at 200 %
     text seven keys of 88 px were three rows over a canvas with no height.
     And closer together: the row is «Отправить», «⋯», four tools — a fifth
     while it is in hand — and the colour, across 360 px. */
  .studio.compact .top,
  .studio.compact .left.sidebar,
  .studio.compact .panel .row:not(.strip-row) {
    --key-h: var(--tap);
  }
  /* A phone's bar is as tall as what is in it — one layer stands whole, with
     no sliver to scroll (owner, 2026-10-07: under a finger the rows are a
     key tall, and the desktop's floor cut the first one) — up to a share of
     the screen, past which the layers scroll in the strip. No divider: there
     is nothing to drag. */
  /* The transport's row is one line on the narrowest phone, as the row over
     the canvas is: on a folded Z Fold (344 px) six keys were a pixel over and
     the sound fell to a second line (owner, 2026-10-07). */
  .studio.compact .panel {
    padding-inline: 0.5rem;
  }
  .studio.compact .panel .row:not(.strip-row),
  .studio.compact .panel .row:not(.strip-row) .transport-keys {
    gap: 0.2rem;
  }
  .studio.compact .panel .row.strip-row {
    flex: none;
  }
  .studio.compact .panel :global(.timeline),
  .studio.compact .panel :global(.board) {
    height: auto;
  }
  .studio.compact .panel :global(.board) {
    max-height: 34dvh;
  }
  /* Undo and redo lying down, in the row: 42.4 px wide — the row took the
     3 px it was short of from the two keys that could shrink. */
  .studio.compact .top .history {
    flex: none;
  }
  .studio.compact .top .history :global(.key) {
    min-width: var(--tap);
  }
  .studio.compact .top {
    gap: 0.25rem;
    padding-inline: 0.5rem;
  }
  .studio.compact .left.sidebar {
    width: calc(var(--tap) + 1.2rem);
  }
  .studio.compact .left.sidebar.lies {
    width: auto;
  }
  /* A phone lying down: the slider is as long as the stage has room for — its
     height less the card's own 4 rem (margins, padding, the number). Counted
     off the screen (100dvh − 16rem) the card was cut on 320 px and the knob
     of a thin brush was under the cut (owner, 2026-10-07). */
  .studio.compact:not(.tall) .left.sidebar :global(.brush-rail) {
    --rail-h: clamp(2rem, var(--stage-h) - 4rem, 9rem);
  }
  /* The seam is the card's edge, not a line down the whole stage: under the
     card it took a strip of the canvas from the pencil. */
  .studio .side-edge:not(.folded) {
    align-self: start;
    height: var(--side-h);
    margin-top: 0.6rem;
  }
  /* Room in a line (the item «Пружина»): what follows stands at the far end. */
  .spring,
  .arr[data-item='spring'] {
    flex: 1;
  }
  .editor.arranging .spring {
    display: block;
    min-width: 2rem;
    height: var(--key-h);
  }
  /* The bar under the canvas floats (owner, 2026-10-05): a card with the
     table showing around it, not a shelf across the studio. The canvas runs
     on under it (CanvasView `--stage-under`), so a sheet moved or magnified
     shows around the card; the fit keeps the sheet clear of it
     (`data-over-sheet`). Beside the canvas — under the columns — the table
     is a layer of the bar's row, since the studio's own ground is paper.
     Folded, it is its tab alone. */
  .studio .panel:not(.collapsed) {
    margin: 0.6rem;
    border-top: none;
    border-radius: var(--r-lg);
  }
  /* A phone lying down with its strip folded: the bar holds nothing else —
     the transport is in the row over the canvas — and is its tab alone, as
     the desktop's folded bar is. */
  .studio .panel.bare {
    height: 0;
    margin: 0;
    padding: 0;
    background: none;
  }
  /* Its rows are in the bar over the canvas, and the empty box of them still
     lay in the bar's clip margin — past the window's edge, so a phone lying
     down scrolled sideways by six pixels. */
  .studio .panel.bare .toolbar {
    display: none;
  }
  .editor.studio::after {
    content: '';
    grid-column: 1 / -1;
    grid-row: 2;
    background: var(--table);
  }
  /* The bar over the canvas ends at the first line and spans one row back:
     a row of its own before the two the template names, there only while the
     bar is — so no area below had to be renumbered for it. Its keys run from
     the near end; a spring among them sends the rest to the far one. */
  .studio .top {
    grid-column: 1 / -1;
    grid-row: span 1 / 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.9rem;
    background: var(--paper);
    border-bottom: 1px solid var(--hairline);
  }
  .editor.arranging .top {
    min-height: var(--key-h);
  }
  /* The colours key: the outline's colour, the fill's peeping from under it. */
  .colour-dot {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 1px var(--edge);
    position: relative;
  }
  .colour-dot::after {
    content: '';
    position: absolute;
    right: -0.3rem;
    bottom: -0.3rem;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--fill);
    box-shadow: 0 0 0 1px var(--edge);
  }
  /* A column holds whatever the config puts in it, so it is a grid of keys:
     loose keys pair up across the width the column was dragged to, and the
     groups (tools, history, the palette and brush boxes) take a row each. */
  .studio .left,
  .studio .right {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(var(--key-h), 100%), 1fr));
    align-content: start;
    background: var(--paper);
    gap: 0.6rem;
    min-height: 0;
    padding: 1rem 0.9rem;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .studio .left > :global(*:not(.key):not(.arr)),
  .studio .right > :global(*:not(.key):not(.arr)),
  .studio .left > .arr.wide,
  .studio .right > .arr.wide {
    grid-column: 1 / -1;
  }
  .studio .left > :global(.key),
  .studio .right > :global(.key) {
    min-width: 0;
  }
  /* A key in a column is as wide as its cell, and its own side padding came
     out of the icon: in a column dragged to one key wide the padded keys —
     export, send, undo, redo — drew their icons a few px across. */
  .studio .left > :global(.key.key),
  .studio .right > :global(.key.key),
  .studio .left .history :global(.key.key),
  .studio .right .history :global(.key.key) {
    /* `.key.key`: the send key's own, wider padding is a later rule of the
       same weight (`.key.primary`), and it kept its icon squeezed out. */
    padding-inline: 0;
  }
  .studio .left :global(.key svg),
  .studio .right :global(.key svg) {
    flex: none;
  }
  .studio .left {
    grid-column: 1;
    grid-row: 1;
    width: 8.4rem;
  }
  .studio .right {
    grid-column: 3;
    grid-row: 1;
    align-items: stretch;
    /* The palette box's own 225px plus the column padding: its floor is also
       its default, so the box is never squashed, only widened. */
    width: 15.9rem;
  }
  /* Dragging a column wider is meant to buy palette columns, not padding —
     and a box moved to the other column has to fit that one too. */
  .studio .left :global(.box),
  .studio .right :global(.box) {
    width: 100%;
  }
  /* The column's inner edge: the drag band and the fold handle, on a line the
     stage does not have to carry — it is drawn only under the cursor, where it
     says what the band does. A grid item, not a child of the column: the
     column scrolls, and would cut the handle in half. */
  .side-edge {
    grid-row: 1;
    align-self: stretch;
    position: relative;
    width: 1px;
    z-index: 4;
    background: transparent;
    /* Only the line's own controls take the pointer; the strip does not sit
       between the canvas and the cursor. */
    pointer-events: none;
  }
  .side-edge > * {
    pointer-events: auto;
  }
  @media (hover: hover) {
    .side-edge:hover {
      background: var(--hairline);
    }
  }
  .side-edge.edge-left {
    grid-column: 1;
    justify-self: end;
  }
  .side-edge.edge-right {
    grid-column: 3;
    justify-self: start;
  }
  /* A 9px band straddling the seam, so the grab target is not a hairline. The
     seam itself is drawn only while that band is in use: a permanent rule down
     the stage is a seam the drawing does not need. */
  .side-resizer {
    position: absolute;
    /* The straight part of the card's edge: over the rounded corners the
       line stood out past the card. */
    inset: var(--r-lg) -4px;
    cursor: ew-resize;
    touch-action: none;
  }
  /* A seam and a tab are drawn thin on purpose — wider, they stop being a
     seam and become furniture. The band that catches the pointer is separate
     from the line that is drawn, and reaches the 24px floor WCAG 2.2 AA asks
     for. Each one borders panel surface, not another control, so nothing else
     loses its own press to it. (Same move as the timeline's column splitter.) */
  .side-resizer::after,
  .resizer::after,
  .fold::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    min-width: 24px;
    min-height: 24px;
    width: 100%;
    height: 100%;
    transform: translate(-50%, -50%);
  }
  /* A folded bar's tab stands on the window's bottom edge: the band's lower
     half hung past it, and the page scrolled by those five pixels. Up only. */
  .panel.collapsed .fold.lying::after,
  .panel.bare .fold.lying::after {
    top: auto;
    bottom: 0;
    transform: translateX(-50%);
  }
  .side-edge.dragging .side-resizer {
    background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
  }
  @media (hover: hover) {
    .side-resizer:hover {
      background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
    }
  }
  /* Focus lands on the seam itself, so it is the seam that has to show it —
     an outline on a 1px box is a hairline halo nobody can see. */
  .side-resizer:focus-visible {
    outline: none;
    background: linear-gradient(var(--accent), var(--accent)) center / 3px 100% no-repeat;
  }
  /* The fold tab: the editor's own key — hairline, 7px radius, 2px of travel
     under the press — grown sideways out of the panel edge. Square where it
     meets the panel, rounded where it meets the stage. */
  .fold {
    position: absolute;
    /* Over the drag band it overlaps: the tab is a button, not a grab area. */
    z-index: 2;
    /* On the corner, level with the first key in the column — floating at
       half height it belongs to nothing. */
    top: 1rem;
    display: grid;
    place-items: center;
    /* The arrow and a pixel, not the arrow: the tab is border-box and drops
       the border on the side it leans against, so a lip the arrow's width
       leaves it a pixel short and the panel paints over what sticks out. The
       arrow is 14px in rem (it grows with the text), so the lip is too —
       15px at 100 %, 29px at 200 %, where a 15px lip hid half of it. */
    width: calc(0.875rem + 1px);
    height: var(--key-h);
    padding: 0;
    border: none;
    background: var(--canvas);
    color: var(--text-2);
    cursor: pointer;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur) var(--ease-out);
  }
  /* The tab leans out over the stage, never over the panel's own contents. */
  .at-left .fold {
    left: 0;
    border-left: none;
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .side-edge:not(.at-left) .fold {
    right: 0;
    border-right: none;
    border-radius: var(--r-sm) 0 0 var(--r-sm);
  }
  @media (hover: hover) {
    .fold:hover {
      background: var(--sub);
      color: var(--text);
    }
  }
  .fold:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* Folded, the tab is all that is left of the column: it waits at the screen
     edge, quiet until the cursor comes for it — quiet being its fill, which it
     shares with the collapsed bar's tab above. Fading the tab itself took the
     `--edge` outline to 1.8:1 and the arrow with it. */
  /* Folded: the column is a bare strip at the screen edge, wide enough to
     carry the circle and nothing else. */
  .studio .left.collapsed,
  .studio .right.collapsed {
    /* Folded, only the tab is left, as with the bar under the canvas. */
    width: 0;
    padding: 0;
    overflow: visible;
    background: none;
  }
  /* Reference «альтернативная раскладка» (`S:2321-2331`): the two side columns
     swap places. Classes only — the DOM order, and so the tab order, is
     untouched. Only in the full layout, where there are columns to swap. */
  .studio.alt .left {
    grid-column: 3;
  }
  .studio.alt .right {
    grid-column: 1;
  }
  .studio.alt .side-edge.edge-left {
    grid-column: 3;
    justify-self: start;
  }
  .studio.alt .side-edge.edge-right {
    grid-column: 1;
    justify-self: end;
  }
  /* In a column the keys fill whatever width it was dragged to: even columns
     when there is room, one when there is not. In a row they stay a row. */
  .studio .left .history,
  .studio .right .history {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(var(--key-h), 100%), 1fr));
    gap: 0.5rem;
  }
  .studio .history :global(.key) {
    min-width: 0;
  }
  .fps-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.4rem;
  }
  .fps-inline input[type='range'] {
    width: 6rem;
    margin: 0;
      /* 16px is the native height of a range and too thin to catch; the track
       stays where it is drawn, the band around it is a finger deep — and a
       finger is the floor DESIGN §5 sets for everything outside the montage
       grid, not the 24 the standard settles for. */
    height: var(--key-h, 2.75rem);
}
  /* Kept focusable while the preview runs: Space on the slider started it,
     and a `disabled` slider dropped the focus to <body>. */
  .fps-inline input[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }
  .fps-inline input[type='number'] {
    width: 3.2rem;
    height: var(--key-h);
    box-sizing: border-box;
    padding: 0 0.3rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  /* Safari on an iPhone zooms the page onto a field under 16 px and leaves
     it zoomed: the studio stayed magnified after typing a rate. */
  @media (pointer: coarse) {
    .fps-inline input[type='number'] {
      font-size: max(16px, 1em);
    }
  }
  /* One rem, never seen: its box changes with the root text size, which a
     text-only zoom changes without resizing the window. */
  .rem-probe {
    position: absolute;
    top: 0;
    left: 0;
    width: 1rem;
    height: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  /* ---- Small screens (small-screen.ts) ----
     The step is worked out in the script from the room the canvas would
     keep, not read off the screen width. `.compact` is a phone: toonop's
     desktop with its bar over the canvas cut to one row of keys. */
  /* Its own full screen hides the site's header: on a phone standing up the
     cutout sat over the first key and the zoom window. Zero elsewhere. */
  .editor.studio:fullscreen {
    padding-top: env(safe-area-inset-top);
  }
  /* «⋯» on a phone: what its one row of keys has no room for. Under the bar
     over the canvas, clear of the sidebar and of the bar below; a card on
     the table, as they are. A menu, not a pile: named groups, each a grid of
     cells of one size. */
  .more-window {
    position: absolute;
    z-index: calc(var(--z-float) + 5);
    top: 0.5rem;
    left: 0.5rem;
    width: min(100% - 1rem, 24rem);
    max-height: calc(100% - 1rem);
    box-sizing: border-box;
    padding: 0.75rem;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--paper);
    border-radius: var(--r-lg);
    /* Down from the bar its key stands on (controls.css). */
    --pop-from: -4px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  .more-window:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .more-title {
    margin: 1rem 0 0.4rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .more-title:first-child {
    margin-top: 0;
  }
  .more-keys {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem;
  }
  /* «Сохранить на устройстве» in half of 390 px stood on four lines, the
     last a lone «е»: the save takes the row. Lying down the keys are a flex
     line at their own width, and the rule means nothing there. */
  .more-keys > :global(.key[aria-keyshortcuts='Control+S']) {
    grid-column: 1 / -1;
  }
  /* The other tools, behind their key in the row: one under another, in a
     plate as wide as the longest name. */
  .more-keys.tool-list {
    grid-template-columns: minmax(11rem, 1fr);
    padding: 0.5rem;
  }
  /* Lying down the height is what the window lacks: a line to a group — its
     name, then its keys at their own width — and the window as wide as they
     are. Stacked across the stage the groups did not fit it and scrolled, and
     the frame rate's slider ran its whole width (owner, 2026-10-07). */
  .studio:not(.tall) .more-window {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.4rem 0.75rem;
    width: fit-content;
    max-width: calc(100% - 1rem);
  }
  .studio:not(.tall) .more-title {
    margin: 0 0 0 0.25rem;
  }
  .studio:not(.tall) .more-keys:not(.tool-list) {
    display: flex;
    flex-wrap: wrap;
  }
  .studio:not(.tall) .more-keys:not(.tool-list) > :global(.key)::before {
    white-space: nowrap;
  }
  .studio:not(.tall) .more-keys > .fps-inline {
    width: 20rem;
    max-width: 100%;
  }
  /* The sound's key in its wrapper (the desktop's row cut to «⋯»): a cell like the rest. */
  .more-keys > .layers {
    display: grid;
  }
  /* Under a finger a bare icon has no title to read: each key says its name
     beside its icon — a tool that opens its brush (PopKey) and the sound's
     key in its wrapper as well, or they stood as nameless discs among named
     keys. `::before`, ordered last: `::after` is the hotkey's under a cursor. */
  .editor .more-keys > .layers > .key,
  .editor .more-keys > :global(.key[aria-label]),
  .editor .more-keys > :global(.pop-key) > :global(.key) {
    justify-content: flex-start;
    gap: 0.6rem;
    width: auto;
    min-width: 0;
    /* «Сохранить на устройстве» is two lines in half of 390 px: the key grows. */
    height: auto;
    min-height: var(--key-h);
    /* The icon a rem and a bit in. Under `.editor`, to outweigh `.editor
       .key.icon`, whose `padding: 0` comes later and put the icon on the
       key's very edge. */
    padding: 0.3rem 0.85rem 0.3rem 1.1rem;
    border-radius: var(--r-md);
    text-align: left;
  }
  /* A name on two lines must not squeeze the icon. */
  .more-keys > .layers > .key > :global(svg),
  .more-keys > :global(.key) > :global(svg),
  .more-keys > :global(.pop-key) > :global(.key) > :global(svg) {
    flex: none;
  }
  .editor .more-keys > .layers > .key::before,
  .editor .more-keys > :global(.key[aria-label])::before,
  .editor .more-keys > :global(.pop-key) > :global(.key)::before {
    content: attr(aria-label);
    order: 1;
    min-width: 0;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.2;
    overflow-wrap: break-word;
  }
  /* What is no key takes the line. «сохранено локально 12:34 · 144 КБ» on
     one line is 458 px at 200 % text. (`.studio` outweighs the public
     `.saved` below, which is `nowrap`.) */
  .studio .more-keys > :global(.saved) {
    grid-column: 1 / -1;
    min-width: 0;
    margin: 0;
    padding-inline: 0.25rem;
    white-space: normal;
  }
  .more-keys > :global(.saved:empty) {
    display: none;
  }
  :global(.saved-note) {
    font-weight: inherit;
  }
  /* The frame rate: a slider with no word on it, so its title is its
     caption; the slider takes what the caption and the box leave. */
  .more-keys > .fps-inline {
    grid-column: 1 / -1;
    min-width: 0;
    box-sizing: border-box;
    padding-inline: 0.25rem;
  }
  .more-keys > .fps-inline::before {
    content: attr(title);
    flex: none;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .more-keys > .fps-inline input[type='range'] {
    flex: 1 1 auto;
    min-width: 0;
  }
  @media (forced-colors: active) {
    .more-window {
      outline: 1px solid CanvasText;
    }
  }
  /* Zoom group: two keys around a tabular readout, so the width does not
     jump as the percentage changes. */
  /* Import failure: an alert over the canvas, dismissed by the user — an
     error about their file must not vanish before it is read. */
  /* Centred by margins, not `left: 50%` + a shift: an absolute box shrinks to
     the room right of its `left`, so the reason wrapped at half the stage and
     ran under the zoom bar. Above the tool windows, whose rung it shared. */
  .import-error {
    position: absolute;
    inset-inline: 0;
    bottom: 1rem;
    z-index: var(--z-float);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: max-content;
    /* The padding inside the 92 %: on top of it the × was cut at the edge
       of a phone's stage. */
    box-sizing: border-box;
    max-width: min(32rem, 92%);
    margin: 0 auto;
    padding: 0.5rem 0.75rem;
    /* DESIGN §5 answers a refusal with the weight of the line, not a colour:
       red belongs to «рисовать» and the Signal Rule names borders and errors
       among the places it may not go. The reason is carried by the words, in
       a `role="alert"` the reader already gets. */
    border: 2px solid var(--ink);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font-size: 0.85rem;
  }
  /* The drop refused over a sheet: the import error's look, in the top layer
     above the sheet, so it takes the browser's popover box off first. */
  .drop-note {
    position: fixed;
    inset: auto 0 1rem;
    z-index: auto;
    pointer-events: none;
  }
  .drop-note:not(.shown) {
    display: none;
  }
  /* Mode notes along the stage's top edge, drawn like the import error: the
     weight of the line, not a colour. The box lets the pointer through to the
     canvas where there is no note. */
  .stage-notes {
    position: absolute;
    inset-inline: 0;
    top: 0.5rem;
    z-index: var(--z-float);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    pointer-events: none;
  }
  /* The first visit's presets: a card on the table like the «⋯» window, told
     from the sheet by tone, not by a shadow. Under the mode notes, which
     speak first. */
  .preset-ask {
    position: absolute;
    z-index: var(--z-float);
    top: 3rem;
    left: 50%;
    translate: -50% 0;
    width: min(100% - 1rem, 26rem);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--sub);
    border-radius: var(--r-lg);
    color: var(--text);
    --pop-from: -4px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  .preset-ask-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .preset-ask h2 {
    margin: 0 0 0 0.25rem;
    font-size: 1rem;
    font-weight: 800;
    text-wrap: balance;
  }
  .preset-ask p {
    margin: 0 0.25rem;
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .preset-ask-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .preset-ask button {
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease-out), color var(--dur) var(--ease-out);
  }
  .preset-ask-chips button {
    flex: 1 0 auto;
    display: grid;
    gap: 0.1rem;
    min-height: var(--key-h);
    padding: 0.4rem 0.6rem;
    text-align: start;
    background: color-mix(in oklab, var(--sub), var(--text) 6%);
  }
  .preset-ask-chips b {
    font-weight: 700;
  }
  .preset-ask-chips span {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  /* The picked one lies on the sheet's white, as a picked row of a popup does. */
  .preset-ask-chips button[aria-pressed='true'] {
    background: var(--canvas);
    color: var(--accent-ink);
  }
  .preset-ask-close {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--key-h);
    height: var(--key-h);
    margin: -0.4rem -0.4rem -0.4rem 0;
  }
  @media (hover: hover) {
    .preset-ask button:not([aria-pressed='true']):hover {
      background: color-mix(in oklab, var(--sub), var(--text) 12%);
    }
  }
  .preset-ask button:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* A phone's sheet is small and the first line wants it: there the card is
     its title and one row of presets. Its panels are the same in every
     preset anyway — the line about them would not be true. */
  /* Under the names a first visit's row of keys wears, which hang below it. */
  .studio.compact .preset-ask {
    top: 2rem;
    padding: 0.5rem;
  }
  .studio.compact .preset-ask-chips span {
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .studio.compact .preset-ask p {
    display: none;
  }
  .studio.compact .preset-ask-chips {
    flex-wrap: nowrap;
  }
  .studio.compact .preset-ask-chips button {
    flex: 1 1 0;
    min-width: 0;
    padding-inline: 0.4rem;
  }
  .stage-note {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    /* The padding inside the 92 %: on top of it the note was 267 px on a
       phone's 260 px stage. */
    box-sizing: border-box;
    max-width: min(32rem, 92%);
    margin: 0;
    padding: 0.25rem 0.75rem;
    border: 2px solid var(--ink);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font-size: 0.85rem;
    pointer-events: auto;
  }
  .layers {
    position: relative;
  }

  /* ---- Sheet chrome ----
     Global, because the sheets are not all in this file any more: the settings
     sheet is its own component and wears the same head / body / hint / foot /
     toggle vocabulary. */
  /* The update lock: a plain card in the middle, nothing to press on it. */
  .updating {
    margin: auto;
    padding: 1rem 1.4rem;
    border: none;
    border-radius: var(--r-md);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-weight: 650;
  }
  .updating::backdrop {
    background: var(--scrim);
  }
  /* The shape comes from the shared `.sheet` chrome; a <dialog> only needs its
     own defaults cleared and a backdrop of its own (as in the settings sheet). */
  .editor :global(.sheet-dialog) {
    margin: 0;
    padding: 0;
    max-width: none;
    border: none;
    color: var(--ink);
  }
  /* The whole line is the target, a finger tall (DESIGN §5). */
  .mute-warning {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--key-h, 2.75rem);
    cursor: pointer;
  }
  .editor :global(.sheet-dialog)::backdrop {
    background: var(--scrim);
  }
  /* The studio's own sheets — the manual, a question — arrive as the settings
     do: a fade, the scrim with them, gone at once (controls.css `studio-pop`).
     Scoped, so the export sheet keeps the rise it gives itself. */
  .sheet-dialog {
    --pop-from: 0px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  .sheet-dialog::backdrop {
    animation: scrim-in var(--dur-enter) var(--ease-out);
  }
  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }
  /* The studio's question: the shared sheet, with a form between it and its
     body and foot — which steps aside so the two stay the sheet's own rows. */
  .ask form {
    display: contents;
  }
  /* No head above it: the question is the first line and wants the head's air. */
  .editor :global(.sheet.ask .sheet-body) {
    padding-block: 1.15rem;
  }
  .ask p {
    margin: 0;
    max-width: 34rem;
    line-height: 1.45;
    text-wrap: pretty;
  }
  .ask-name {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--key-h, 2.75rem);
    margin-top: 0.75rem;
    padding: 0 0.85rem;
    /* The edge a control is known by (DESIGN: Edge-vs-Hairline). */
    border: 1px solid var(--edge);
    border-radius: var(--r-md);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
  }
  .ask-name:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 1px;
  }
  /* Bottom sheet on mobile, centered card on wider screens. */
  .editor :global(.sheet) {
    position: fixed;
    z-index: var(--z-sheet);
    left: 0;
    right: 0;
    /* A modal <dialog> brings `inset-block: 0` from the browser's sheet, and
       with both edges pinned and the height its content's, `top` wins: the
       sheet hung from the top of the phone, out of the thumb's reach. */
    top: auto;
    bottom: 0;
    /* A <dialog> is `width: fit-content` by the browser's sheet, so pinning
       both edges was not enough: the sheet grew to its widest line and took
       its close key off a 320px screen. */
    width: auto;
    display: flex;
    flex-direction: column;
    max-height: 85dvh;
    /* Edge to edge — under 641 px, a small phone lying down or any phone at
       200 % text — its close key sat under the cutout. */
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
    background: var(--canvas);
    border-top-left-radius: var(--r-md);
    border-top-right-radius: var(--r-md);
    box-shadow: var(--shadow-sheet);
  }
  @media (min-width: 40.0625rem) {
    .editor :global(.sheet) {
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      /* Fixed: `100%` is the initial containing block, scrollbar excluded. */
      width: min(24rem, calc(100% - 2rem));
      /* Centred, it is clear of any cutout. */
      padding-inline: 0;
      border-radius: var(--r-md);
      /* Not a sheet any more: all four corners, all four sides, floating over
         the scrim. The sheet's lift points up because it rises from an edge —
         centred, that leaves it standing on nothing. */
      box-shadow: var(--shadow-plate);
    }
  }
  /* A low screen (sheetScrollsWhole): the head and the foot pinned took all
     but a slit of the sheet, so the sheet scrolls as one and they go with it. */
  .editor.low :global(.sheet) {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .editor.low :global(.sheet-body) {
    flex: none;
    overflow-y: visible;
  }
  .editor :global(.sheet-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.9rem 1rem 0.6rem;
    border-bottom: 1px solid var(--hairline);
  }
  .editor :global(.sheet-head h2) {
    /* At 200 % text on a phone the title and the close key share 256px: the
       title breaks rather than running under the key. */
    min-width: 0;
    overflow-wrap: anywhere;
    /* …and where it must break a word, at a syllable with a hyphen, not
       «Настрой / ки». */
    -webkit-hyphens: auto;
    hyphens: auto;
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .editor :global(.sheet-body) {
    /* A flex child's min-height is its content unless told otherwise, which
       would push the footer out of a full sheet instead of scrolling. */
    min-height: 0;
    overflow-y: auto;
    padding: 0.4rem 1rem 0.6rem;
    /* A file name, an address or a long word at 200 % text breaks inside the
       sheet instead of widening it. */
    overflow-wrap: anywhere;
  }
  /* The sheet clips its sides: the ring goes inside the body it marks. */
  .editor :global(.sheet-body:focus-visible) {
    outline-offset: -3px;
  }
  .editor :global(.sheet-hint) {
    margin: 0.7rem 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  /* The key column is as wide as its widest chip, up to half the sheet; a
     fixed 4.6rem broke «Del / Backspace» and «Ctrl+Shift+Z» mid-word. The
     row wrapper steps aside (display: contents), so dt and dd sit in the
     list's own columns; subgrid would need Chrome 117. */
  .keylist {
    margin: 0;
    display: grid;
    grid-template-columns: fit-content(50%) 1fr;
    column-gap: 0.75rem;
    row-gap: 0.1rem;
  }
  .keyrow {
    display: contents;
  }
  .keyrow dt,
  .keyrow dd {
    margin: 0;
    padding: 0.32rem 0;
    align-self: baseline;
  }
  .keylist kbd {
    display: inline-block;
    min-width: 1.9rem;
    padding: 0.15rem 0.45rem;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--ink);
  }
  .keylist dd {
    font-size: 0.9rem;
    color: var(--ink-2);
  }
  /* A gesture is a phrase, not a key cap: in ink, at the reading size. */
  .keylist.gestures dt {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink);
  }
  .keylist + :global(.sheet-hint) {
    margin-top: 1rem;
  }
  .editor :global(.toggle) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.9rem;
    padding: 0 0.3rem;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  @media (hover: hover) {
    .editor :global(.toggle:hover) {
      background: var(--sub);
    }
  }
  .editor :global(.toggle + .toggle) {
    border-top: 1px solid var(--hairline-soft);
  }
  .editor :global(.toggle-label) {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.95rem;
  }
  .editor :global(.sheet-foot) {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem 1rem;
    padding-bottom: max(0.7rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--hairline);
  }

  /* ---- Shared button vocabulary (global so child components inherit it) ---- */
  /* Key: a flat white pill on the panel's paper (web-look «Студия в том же
     виде»), known by its fill and its icon like the site's buttons — a control
     with a visible label needs no 3:1 edge (WCAG 1.4.11 Understanding). The
     press is felt as a squeeze, not a hard key under it. */
  .editor :global(.key) {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-width: var(--key-h);
    height: var(--key-h);
    padding: 0 0.7rem;
    border: none;
    border-radius: var(--r-pill);
    background: var(--canvas);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform var(--dur-fast) var(--ease-out),
      background var(--dur) var(--ease-out),
      color var(--dur) var(--ease-out);
  }
  /* The key's name by the key (`nameKey`): in ink, the one tone that reads on
     the paper of a panel, the table and the sheet alike. Fixed, in the top
     layer where there is one; never in the pointer's way. */
  .key-name {
    position: fixed;
    inset: auto;
    top: var(--y);
    z-index: var(--z-menu);
    width: max-content;
    max-width: min(22rem, 100% - 1rem);
    margin: 0;
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--canvas);
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1.3;
    translate: -50% 0.4rem;
    pointer-events: none;
  }
  .key-name.over {
    translate: -50% calc(-100% - 0.4rem);
  }
  .key-name:not(.shown) {
    display: none;
  }
  /* A first visit on a phone: the row of keys wears its names, until the first
     stroke. Hung under the bar, out of the flow — the bar keeps its height and
     the sheet does not jump under the stroke that puts them away. */
  /* …and on a tablet, laid out as the desktop but with no cursor to hover
     with: only the keys a first visit starts with — send, brush, eraser,
     colours. The wide row holds a dozen more, and their names would run on. */
  .studio.compact.named .top :global(.key)::after,
  .studio.fingers.named:not(.compact) .top :global(:is(.key.publish, .key[data-walk], .key[data-tool='pencil'], .key[data-tool='eraser']))::after {
    content: attr(aria-label);
    position: absolute;
    top: calc(100% + 0.5rem + 3px);
    left: 50%;
    z-index: var(--z-float);
    translate: -50% 0;
    color: var(--text-2);
    /* The keys stand 48 px apart, so a name wider than that wears a short one
       (`data-name`): lying down the transport is in this row too, and
       «Предыдущий кадр» lay across «Добавить кадр» and «Следующий кадр».
       The label step, drawn a touch closer. */
    font-size: 0.7rem;
    letter-spacing: -0.02em;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
  }
  .studio.compact.named .top :global(.key[data-name])::after,
  .studio.fingers.named:not(.compact) .top :global(.key.publish[data-name])::after {
    content: attr(data-name);
  }
  /* A wider phone (412 px) has room for more tools in the row, and their names
     — «Перо», «Мега-ластик», «Трансформация» — ran into one another (owner,
     2026-10-08). The first visit names the two it starts with; the rest are
     named by their own tooltip, as everywhere. */
  .studio.compact.named .top :global(.key[data-tool]:not([data-tool='pencil'], [data-tool='eraser']))::after {
    content: none;
  }
  .editor :global(.saved:empty) {
    padding: 0;
  }
  .editor :global(.saved) {
    padding: 0 0.4rem;
    font-size: 0.78rem;
    color: var(--ink-2);
    white-space: nowrap;
  }
  /* In the bar over the canvas the status is no word in the row — at its 200 px
     it wrapped the row, and cut to «сох…» it said nothing — but a note under
     the bar, shown with each save and gone by itself (owner, 2026-10-07).
     Out of the flow, apart by its tone; a failed save stays. */
  .studio .top {
    position: relative;
  }
  /* The host's note as a line of the bar, under the keys: its own row of the
     wrap, so the keys do not move. While the row wears its names they hang
     between the keys and the line. */
  .studio .top > .top-note {
    flex: 0 0 100%;
    min-width: 0;
  }
  /* The host has nothing to say most of the time, and the holder is still a
     row of the wrap: with its gap and its margin it stood the bar taller, and
     the bar dropped back whenever «⋯» took the note down (owner, 2026-10-08).
     No words, no row. */
  .studio .top > .top-note:empty {
    display: none;
  }
  .studio.compact.named .top > .top-note,
  .studio.fingers.named .top > .top-note {
    margin-top: 1.725rem;
  }
  .studio .top > :global(.saved) {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 50%;
    z-index: var(--z-float);
    padding: 0;
    translate: -50% 0;
    pointer-events: none;
  }
  .studio .top > :global(.saved > .saved-note) {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.8rem;
    border-radius: var(--r-pill);
    background: var(--sub);
    color: var(--ink);
    font-weight: 500;
  }
  .studio .top > :global(.saved[role='status'] > .saved-note) {
    animation: saved-note 4s ease forwards;
  }
  @keyframes saved-note {
    0%,
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      visibility: hidden;
    }
  }
  .editor :global(.key.icon) {
    padding: 0;
  }
  /* Only where a pointer hovers: a touch «hover» sticks after a tap, and a
     key switched off (the onion skin) kept the tone as if still pressed. */
  @media (hover: hover) {
    .editor :global(.key:hover:not(:disabled)) {
      background: var(--sub);
    }
  }
  .editor :global(.key:active:not(:disabled)) {
    transform: scale(0.96);
  }
  .editor :global(.key:focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .editor :global(.key:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  /* A key its own press switches off (⏮ on the first frame, «Удалить кадр»
     on Toonio's last) is aria-disabled, not disabled: `disabled` under the
     focus dropped it to <body>. It looks the same. */
  .editor :global(.key[aria-disabled='true']) {
    opacity: 0.4;
    cursor: default;
  }
  /* Picked: a light wash of the accent under a red icon. */
  .editor :global(.key.active) {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
  }
  @media (hover: hover) {
    .editor :global(.key.active:hover:not(:disabled)) {
      background: color-mix(in srgb, var(--accent) 22%, var(--canvas));
    }
  }
  /* Primary key: the one positive "ship" action — the red fill, white icon
     (4.76:1), a step darker under the cursor like the site's red button. */
  .editor :global(.key.primary) {
    padding: 0 1rem;
    background: var(--accent);
    color: var(--canvas);
  }
  /* On a sheet the page is white too, so a white key read as a bare word
     («Скачать палитры», «GIF»): there it takes the ghost fill (DESIGN.md). */
  .editor :global(.sheet .key:not(.primary):not(.active)) {
    background: var(--sub);
  }
  @media (hover: hover) {
    .editor :global(.sheet .key:not(.primary):not(.active):hover:not(:disabled)) {
      background: color-mix(in oklab, var(--sub), var(--text) 8%);
    }
  }
  .editor :global(.key.primary.icon) {
    padding: 0;
  }
  @media (hover: hover) {
    .editor :global(.key.primary:hover:not(:disabled)) {
      background: var(--accent-ink);
    }
  }

  /* Reduced motion keeps the pressed tone, not the squeeze. */
  @media (prefers-reduced-motion: reduce) {
    .editor :global(.key) {
      transition: background var(--dur) var(--ease-out), color var(--dur) var(--ease-out);
    }
    .editor :global(.key:active:not(:disabled)) {
      transform: none;
    }
  }
  /* Safari 16.0 and 16.1 have no color-mix(): with a var() in it the value is
     invalid when computed and the tint went to nothing. The nearest token. */
  @supports not (color: color-mix(in srgb, red, red)) {
    .panel.collapsed .fold,
    .side-edge.folded .fold {
      background: var(--canvas);
    }
    .editor :global(.key.active) {
      background: var(--accent-wash);
    }
    @media (hover: hover) {
      .editor :global(.key.active:hover:not(:disabled)) {
        background: var(--accent-wash);
      }
      .editor :global(.sheet .key:not(.primary):not(.active):hover:not(:disabled)) {
        background: var(--sub);
      }
    }
  }
</style>
