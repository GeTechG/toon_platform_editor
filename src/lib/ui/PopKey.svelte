<script lang="ts">
  /**
   * A key on a bar with its box behind it: pressed, the box opens under the
   * key; a press elsewhere, Esc or the key again closes it. The top bar's form
   * of the colours and of a tool's brush (toonop) — the sound's plate, made
   * general.
   */
  import { plateAt, type PlatePlace } from './pop-place';
  import type { Snippet } from 'svelte';
  import { notePopupClosed } from './dismiss-press';

  let {
    label,
    title = label,
    face,
    children,
    active = false,
    gate,
    shutOn,
    attrs = {},
  }: {
    /** Drawn as pressed though its box is shut: a tool in hand. */
    active?: boolean;
    /** Asked at each press: false — the press did something else, the box stays as it is. */
    gate?: () => boolean;
    /** The box shuts when this changes: a list one picks from, done once the pick is made. */
    shutOn?: unknown;
    /** What else the key carries: its hotkey, its pressed state. */
    attrs?: Record<string, unknown>;
    label: string;
    title?: string;
    /** What the key shows: an icon, the colour in hand. */
    face: Snippet;
    children: Snippet;
  } = $props();

  let open = $state(false);
  let key = $state<HTMLButtonElement | undefined>();
  let plate = $state<HTMLDivElement | undefined>();
  let at = $state<PlatePlace | undefined>();
  /** Bumped by a window resize: the key moves with the layout, the plate follows. */
  let resized = $state(0);

  /**
   * Under its key, right edges flush, inside the window; over it where the
   * key sits nearer the bottom (the bar dragged to a bottom row).
   */
  $effect(() => {
    void resized;
    if (!open || !key || !plate) return;
    const k = key.getBoundingClientRect();
    // A column standing beside the canvas; lying along its foot it is a row of keys.
    const column = key.closest('aside:not(.lies)')?.getBoundingClientRect();
    const view = { w: window.innerWidth, h: window.innerHeight };
    // Told before the box is measured: a box may lay itself out by the room
    // it has (the colours in a low window), and that changes its width.
    plate.style.setProperty('--room', `${column ? view.h - 28 : Math.max(k.top - 14, view.h - k.bottom - 14)}px`);
    at = plateAt(k, { w: plate.offsetWidth, h: plate.offsetHeight }, view, column);
  });

  // Open, its column stands over the rest of the studio: the plate is in the
  // column's own layer, and the strip's pinned cells lay over a window that
  // reached down to the bar (toonop's desk: the brush under the colours).
  $effect(() => {
    const column = open ? key?.closest('aside') : null;
    column?.classList.add('popped');
    return () => column?.classList.remove('popped');
  });

  // A press anywhere else closes it and still does its own work — a key is
  // pressed, the stroke that follows a colour starts with that press. A tap on
  // the sheet is the one press that only closes (owner, 2026-10-08): it left a
  // dot of the brush nobody meant, and the sheet is told of it (dismiss-press.ts).
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const hit = e.target as Node | null;
      if (hit && !plate?.contains(hit) && !key?.contains(hit)) {
        open = false;
        notePopupClosed(e);
      }
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });

  // A gated key's box belongs to its being active: the tool changed by a
  // hotkey, and the box showed another tool's brush under this key.
  $effect(() => {
    if (gate && !active) open = false;
  });

  // A list is done with once something is taken from it: the other tools'
  // stayed open over the window of the tool just picked. A box one works in
  // (the brush, the colours) names nothing here and stays.
  $effect(() => {
    void shutOn;
    open = false;
  });

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented || !open) return;
    // A list open inside (the brush types, the harmonies) takes this Esc: the
    // browser closes it after the key, which still bubbles here unprevented.
    try {
      if (plate?.querySelector(':popover-open')) return;
    } catch {
      // No `popover` in this browser: such a list handles its own Esc.
    }
    e.stopPropagation();
    open = false;
    key?.focus();
  }
</script>

<svelte:window onresize={() => resized++} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pop-key" onkeydown={onKey}>
  <button
    class="key icon"
    {...attrs}
    class:active={open || active}
    aria-expanded={open}
    bind:this={key}
    onclick={() => {
      if (!gate || gate()) open = !open;
    }}
    {title}
    aria-label={label}
  >
    {@render face()}
  </button>
  {#if open}
    <!-- A group, not a dialog: it takes no focus of its own, and the page
         behind it stays live (the sound's plate, for the same reasons). -->
    <div
      class="pop-plate"
      class:up={at?.bottom !== undefined}
      role="group"
      aria-label={label}
      bind:this={plate}
      style:left={at && `${at.x}px`}
      style:top={at?.top !== undefined ? `${at.top}px` : undefined}
      style:bottom={at?.bottom !== undefined ? `${at.bottom}px` : undefined}
      style:max-height={at && `${at.max}px`}
      style:visibility={at ? undefined : 'hidden'}
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .pop-key {
    display: contents;
  }
  .pop-plate {
    position: fixed;
    /* Over the whole stack of floating windows: the zoom window, once pressed, stands on its top rung (+4) and lay over the colours. */
    z-index: calc(var(--z-float) + 5);
    box-sizing: border-box;
    /* As wide as the box in it: the brush box is 225px, the colours 21rem,
       and a plate of one width stood half empty around the narrower.
       Fixed, so `100%` is the window — the room that actually exists. */
    width: max-content;
    max-width: calc(100% - 16px);
    /* The height under (or over) the key, set at each placing; the box in the
       plate may lay itself out by it. */
    --room: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Over the stage by tone, as the scale window: white read as the sheet. */
    background: var(--paper);
    /* A hair of an edge: over the bars it lies paper on paper. */
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    /* It comes out of its key (controls.css); shut, it is simply gone. The
       side is named, not left to the default: a window it stands in fades
       in place, and its `0px` would be inherited here. */
    --pop-from: -4px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  /* Over its key, it comes up from it. */
  .pop-plate.up {
    --pop-from: 4px;
  }
  /* The box in it lies on the plate's paper: white, it read as a piece of
     the sheet under it. */
  .pop-plate :global(.box) {
    background: transparent;
  }
  @media (forced-colors: active) {
    .pop-plate {
      outline: 1px solid CanvasText;
    }
  }
</style>
