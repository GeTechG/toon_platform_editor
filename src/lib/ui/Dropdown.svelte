<script lang="ts" generics="T">
  /**
   * The studio's drop-down list: a button that names what is picked and a
   * list of options in the top layer. The system list was the one control in
   * the studio drawn by the browser — its own font, its own blue, a different
   * box in every engine.
   *
   * The list is a popover, as the brush types' list is: a sheet's body scrolls
   * and a sheet is moved by a transform, so anything opened inside it would be
   * cut at its edge and placed by the wrong corner. In the top layer it is
   * clipped by nothing, and the browser closes it on Escape and on a press
   * elsewhere by itself — before the sheet under it, not with it.
   */
  import Icon from './Icon.svelte';
  import { letterOption, placeDropdown, stepOption, type DropdownPlace } from './dropdown';

  let {
    label,
    value,
    options,
    onpick,
  }: {
    /** What is being chosen: the list's name, and the first half of the button's. */
    label: string;
    value: T;
    options: { value: T; label: string }[];
    /** Only for an option other than the picked one. The owner moves `value`, or leaves it. */
    onpick: (value: T) => void;
  } = $props();

  /**
   * Safari before 17 and Firefox before 125 have no `popover`, and no top
   * layer to lift the list out of the sheet: there the system list stays.
   */
  const popoverWorks = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

  const listId = $props.id();
  let list = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let at = $state<DropdownPlace & { minWidth: number }>({ x: 0, y: 0, maxHeight: null, minWidth: 0 });

  const current = $derived(options.find((option) => option.value === value));

  function place(): void {
    if (!list || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    at = {
      ...placeDropdown(
        anchor,
        // The whole list, not what an earlier limit left of it; as wide as its button at least.
        { width: Math.max(list.offsetWidth, anchor.width), height: list.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
      minWidth: anchor.width,
    };
  }

  function keys(): HTMLButtonElement[] {
    return [...(list?.querySelectorAll<HTMLButtonElement>('.option') ?? [])];
  }

  function opened(now: boolean): void {
    open = now;
    if (!now) return;
    place();
    const all = keys();
    (all.find((key) => key.getAttribute('aria-selected') === 'true') ?? all[0])?.focus();
  }

  function walk(e: KeyboardEvent): void {
    // Esc is the list's: the browser closes it, and whatever stands under it —
    // the arrange mode listens on the window — must not close along with it.
    if (e.key === 'Escape') {
      e.stopPropagation();
      return;
    }
    const all = keys();
    const from = all.indexOf(document.activeElement as HTMLButtonElement);
    // A letter, when no chord is held: Ctrl+S is not a search for «с».
    const letter = e.ctrlKey || e.metaKey || e.altKey ? null : letterOption(e.key, from, options.map((option) => option.label));
    const next = stepOption(e.key, from, all.length) ?? letter;
    if (next === null) return;
    // The list's own key: the studio's arrows move frames, and must not here.
    e.preventDefault();
    e.stopPropagation();
    all[next].focus();
  }
</script>

<!-- The sheet scrolled or the window resized under an open list: it follows its button. -->
<svelte:window onresize={() => open && place()} onscrollcapture={() => open && place()} />

{#if popoverWorks}
  <!-- Not inside a <label>: its words would become the button's whole name,
       and what is picked would go unread. The name says both. -->
  <button
    class="trigger"
    bind:this={trigger}
    popovertarget={listId}
    onkeydown={(e) => {
      // The arrows open it, as they open the browser's list it stands for;
      // the studio's arrows move frames, and must not from here.
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
        e.preventDefault();
        e.stopPropagation();
        list?.showPopover();
      }
    }}
    aria-haspopup="listbox"
    aria-label={`${label}: ${current?.label ?? ''}`}
  >
    <span class="name">{current?.label ?? ''}</span>
    <Icon name={open ? 'chevron-up' : 'chevron-down'} />
  </button>
  <div
    class="list"
    id={listId}
    popover
    role="listbox"
    tabindex="-1"
    aria-label={label}
    bind:this={list}
    style:left="{at.x}px"
    style:top="{at.y}px"
    style:min-width="{at.minWidth}px"
    style:max-height={at.maxHeight === null ? null : `${at.maxHeight}px`}
    onbeforetoggle={(e) => {
      // `toggle` comes a task later, after a frame drawn where the list was
      // left — the first time, at 0,0. The frame's own callback runs with the
      // list laid out and before it is painted.
      if ((e as ToggleEvent).newState === 'open') requestAnimationFrame(place);
    }}
    ontoggle={(e) => opened((e as ToggleEvent).newState === 'open')}
    onkeydown={walk}
    onfocusout={(e) => {
      // Tab out of the list closes it: left open, it covers what the focus
      // has moved on to. Not to its own button — a press there closes it.
      const to = e.relatedTarget as Node | null;
      if (to && !list?.contains(to) && !trigger?.contains(to)) list?.hidePopover();
    }}
  >
    {#each options as option (option.value)}
      <!-- One stop of Tab for the whole list: the arrows and the letters walk it. -->
      <button
        class="option"
        tabindex="-1"
        role="option"
        aria-selected={option.value === value}
        onclick={() => {
          list?.hidePopover();
          // The browser hands the focus back only to a button that had it:
          // Safari never focuses a pressed one, and the focus fell to the page.
          trigger?.focus();
          if (option.value !== value) onpick(option.value);
        }}
      >{option.label}</button>
    {/each}
  </div>
{:else}
  <select
    aria-label={label}
    value={options.findIndex((option) => option.value === value)}
    onchange={(e) => {
      const picked = options[Number(e.currentTarget.value)];
      // The owner may refuse: the list shows what is on, not what was asked.
      e.currentTarget.value = String(options.findIndex((option) => option.value === value));
      if (picked) onpick(picked.value);
    }}
  >
    {#each options as option, index (option.value)}
      <option value={index}>{option.label}</option>
    {/each}
  </select>
{/if}

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
    min-height: var(--key-h, 2.75rem);
    padding: 0 0.6rem 0 0.85rem;
    border: none;
    border-radius: var(--r-sm);
    /* Told apart from what it lies on by tone, as the brush types' button. */
    background: var(--sub);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .trigger :global(svg) {
    flex: none;
    color: var(--ink-2);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list {
    position: fixed;
    /* A popover comes with `inset: 0` and `margin: auto`: centred in the window. */
    inset: auto;
    margin: 0;
    width: max-content;
    /* Fixed, so `100%` is the initial containing block — the room that
       actually exists, where `100vw` counts the scrollbar in as well. */
    max-width: calc(100% - 16px);
    max-height: calc(100% - 16px);
    overflow-y: auto;
    padding: 4px;
    border: none;
    border-radius: var(--r-md);
    /* Tone, not a shadow (owner, 2026-10-05): the list is a step darker than
       the sheet, the picked option lies on the canvas. */
    background: var(--sub);
    color: var(--ink);
  }
  /* A closed popover is hidden by the browser's own `display: none`, which
     any layout declared on `.list` would quietly override. */
  .list:popover-open {
    display: grid;
    gap: 2px;
  }
  .option {
    display: flex;
    align-items: center;
    min-height: var(--key-h, 2.75rem);
    padding: 0 0.85rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  @media (hover: hover) {
    .option:hover {
      /* A token, not a mix: a hair of ink over the list's tone. */
      background: var(--hairline-soft);
    }
  }
  .option[aria-selected='true'] {
    background: var(--canvas);
    color: var(--accent-ink);
    font-weight: 650;
  }
  /* Inside: the list clips what is drawn past its edge. */
  .option:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  /* Fills are dropped in forced colours: an edge instead. */
  @media (forced-colors: active) {
    .trigger,
    .list {
      outline: 1px solid CanvasText;
    }
  }
</style>
