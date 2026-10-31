<script lang="ts">
  // A first visit's tour (owner, 2026-10-12): a hello with the host's mascot,
  // a few pages on what the studio can do, each a small looped picture and a
  // line of words, and the choice of a preset where a plugin brought a second
  // one. It stands where
  // the presets' plate stood and blocks nothing: the sheet under it draws.
  import Icon from './Icon.svelte';
  import { t } from '../i18n';
  import { presetAbout, presets } from './presets';
  import { tourPages } from './tour';
  import type { EditorState } from './editor-state.svelte';

  let { editor, mascot, platform, desk }: { editor: EditorState; mascot?: string; platform: boolean; desk: boolean } = $props();
  const pages = $derived(tourPages(platform, desk, presets().length));
  let at = $state(0);
  // The window narrowed to a phone mid-tour: the panels' page goes, the count stays in range.
  const page = $derived(pages[Math.min(at, pages.length - 1)]);
</script>

<section class="preset-ask" aria-labelledby="preset-ask-title">
  <div class="preset-ask-head">
    <h2 id="preset-ask-title">{page === 'layout' ? t('intro.title') : t(`tour.${page}.title`)}</h2>
    <button class="preset-ask-close" aria-label={t('picker.close')} onclick={() => editor.closePresetAsk()}><Icon name="x" size={16} /></button>
  </div>
  {#if page === 'welcome'}
    {#if mascot}<img class="mascot" src={mascot} alt="" />{/if}
  {:else if page === 'toon'}
    <!-- A .toon file is carried over the studio and let go: the drawing is there. -->
    <div class="art" aria-hidden="true">
      <div class="scene">
        <div class="win">
          <i></i>
          <svg viewBox="0 0 80 40"><path class="line" d="M10 28 C 20 4, 30 38, 42 18 S 62 6, 70 24" pathLength="1" /></svg>
        </div>
        <span class="file">.toon<svg viewBox="0 0 12 14"><path d="M1 1v11l3-3 2 4 2-1-2-4h4z" /></svg></span>
      </div>
    </div>
  {:else if page === 'plugins'}
    <!-- One more key comes into the row of tools. -->
    <div class="art" aria-hidden="true">
      <div class="scene keys">
        {#each ['pencil', 'eraser', 'pipette', 'lasso'] as const as name (name)}
          <span class="k"><Icon {name} size={18} /></span>
        {/each}
        <span class="k new"><Icon name="feather" size={18} /></span>
      </div>
    </div>
  {:else if page === 'panels'}
    <!-- The panels stand; a key is carried from one of them to the other. -->
    <div class="art" aria-hidden="true">
      <div class="scene">
        <div class="desk"><i class="leaf"></i><i class="pan"></i><i class="pan r"></i><i class="move"></i></div>
      </div>
    </div>
  {:else if page === 'export'}
    <!-- The frames, played through, come out as files. -->
    <div class="art" aria-hidden="true">
      <div class="scene">
        <div class="strip"><i></i><i></i><i></i><i></i></div>
        <span class="head"></span>
        <div class="out"><b class="o1">GIF</b><b class="o2">MP4</b><b class="o3">PNG</b></div>
      </div>
    </div>
  {:else if page === 'continue'}
    <!-- Other people's toons grow out of one published. -->
    <div class="art" aria-hidden="true">
      <div class="scene">
        <svg class="links" viewBox="0 0 160 80">
          <path class="l1" d="M52 40 C 70 40, 70 20, 88 20" pathLength="1" />
          <path class="l2" d="M52 40 C 70 40, 70 60, 88 60" pathLength="1" />
        </svg>
        <span class="toon t0"><Icon name="play" size={16} /></span>
        <span class="toon t1"><Icon name="pencil" size={16} /></span>
        <span class="toon t2"><Icon name="pencil" size={16} /></span>
      </div>
    </div>
  {:else if page === 'open'}
    <!-- The editor is copied, the copy is changed, and the change comes home. -->
    <div class="art" aria-hidden="true">
      <div class="scene">
        <div class="fork f0"><i></i><u></u><b class="b0"></b></div>
        <div class="fork f1"><i></i><u></u><b class="b1"></b></div>
        <span class="patch"></span>
      </div>
    </div>
  {:else}
    <!-- Which studio to draw in. Pressed, a preset lays the panels out at
         once — the studio is its own preview. -->
    <div class="preset-ask-chips">
      {#each presets() as p (p.id)}
        <button aria-pressed={editor.preset === p.id} onclick={() => editor.applyPreset(p.id)}>
          <b>{p.label}</b>
          <span>{presetAbout(p.id)}</span>
        </button>
      {/each}
    </div>
    <p class="preset-ask-picked">{presetAbout(editor.preset)}</p>
  {/if}
  <p aria-live="polite">{page === 'layout' ? t('intro.later') : t(`tour.${page}.text`)}{#if page === 'open'}{' '}<a href="https://github.com/GeTechG/toon_platform_editor" target="_blank" rel="noopener">GeTechG/toon_platform_editor</a>{/if}</p>
  <div class="tour-foot">
    {#if at === 0}
      <button class="key" onclick={() => editor.closePresetAsk()}>{t('tour.skip')}</button>
      <button class="key primary" onclick={() => (at = 1)}>{t('tour.start')}</button>
    {:else}
      <span class="tour-at">{t('tour.page', { at, of: pages.length - 1 })}</span>
      <button class="key" onclick={() => at--}>{t('tour.back')}</button>
      {#if at < pages.length - 1}
        <button class="key primary" onclick={() => at++}>{t('tour.next')}</button>
      {:else}
        <button class="key primary" onclick={() => editor.closePresetAsk()}>{t('tour.done')}</button>
      {/if}
    {/if}
  </div>
</section>

<style>
  /* A card in the middle of the table, of the «⋯» window's paper: in the
     table's own tone and under its top edge it ran into everything around
     (owner, 2026-10-13). Told by tone, not by a shadow. Centred by margins:
     `translate` is the arrival's. */
  .preset-ask {
    position: absolute;
    z-index: var(--z-float);
    inset: 0;
    margin: auto;
    width: min(100% - 1rem, 30rem);
    height: fit-content;
    /* A low stage (a phone lying down) scrolls the card, not cuts it. */
    max-height: calc(100% - 1rem);
    overflow-y: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--paper);
    border-radius: var(--r-lg);
    color: var(--text);
    --pop-from: 0px;
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
  .preset-ask > p {
    margin: 0 0.25rem;
    font-size: 0.85rem;
    color: var(--text-2);
    text-wrap: pretty;
  }
  .preset-ask > p a {
    color: var(--accent-ink);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  .preset-ask > p a:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .mascot {
    align-self: center;
    /* On a stage lower than the card it is the picture that gives way (owner,
       2026-10-13, an iPhone SE under Toonio: «Пройти тур» lay under the edge). */
    min-height: 3rem;
    height: 9rem;
    width: auto;
    max-width: 100%;
    object-fit: contain;
  }
  .tour-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  /* A key's words stay in one line: in a 250 px card «Пройти тур» broke in two
     and ran out of its key (owner, 2026-10-13). */
  .tour-foot .key {
    white-space: nowrap;
  }
  :global(.studio.compact) .tour-foot .key {
    padding-inline: 0.75rem;
    font-size: 0.95rem;
  }
  .tour-at {
    margin: 0 auto 0 0.25rem;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .preset-ask-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .preset-ask-chips button,
  .preset-ask-close {
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
    align-content: start;
    gap: 0.1rem;
    min-height: var(--key-h);
    padding: 0.4rem 0.6rem;
    text-align: start;
    background: var(--sub);
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
    .preset-ask-chips button:not([aria-pressed='true']):hover,
    .preset-ask-close:hover {
      background: var(--hairline);
    }
  }
  .preset-ask-chips button:focus-visible,
  .preset-ask-close:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* A phone's sheet is small: there the presets stand by name in one row with
     the word about the picked one under them — three such words abreast did
     not fit a 360 px screen — and the line about the settings is dropped. */
  .preset-ask .preset-ask-picked {
    display: none;
  }
  :global(.studio.compact) .preset-ask {
    padding: 0.5rem;
  }
  :global(.studio.compact) .preset-ask-chips ~ p,
  :global(.studio.compact) .preset-ask-chips span {
    display: none;
  }
  :global(.studio.compact) .preset-ask .preset-ask-picked {
    display: block;
  }
  /* By the name's length, not in thirds: under Toonio's column of tools the
     card is 250 px wide, and a third of it cut «Multator» (owner, 2026-10-13). */
  :global(.studio.compact) .preset-ask-chips button {
    flex: 1 1 auto;
    padding-inline: 0.4rem;
    font-size: 0.9rem;
    align-content: center;
    text-align: center;
  }
  :global(.studio.compact) .mascot {
    height: 6.5rem;
  }

  /* The pictures: a white well with a scene in it that a wider card does not
     stretch. Every moving part is one class and rests where its
     road ends — that is what stands when motion is turned off. */
  .art {
    container-type: inline-size;
    display: grid;
    place-items: center;
    background: var(--canvas);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  /* One share of the well's width, a rem where there is room: under Toonio's
     rail a phone's card is 250 px, and a scene of 16rem ran out of it (owner,
     2026-10-13). Every size below is counted in it. */
  .scene {
    --u: 1rem;
    position: relative;
    flex: none;
    width: calc(16 * var(--u));
    height: calc(8 * var(--u));
  }

  @supports (width: 1cqw) {
    .scene {
      --u: min(1rem, 100cqw / 16);
    }
  }

  /* .toon dropped on the studio */
  .win {
    position: absolute;
    left: calc(1.5 * var(--u));
    top: calc(1 * var(--u));
    width: calc(9 * var(--u));
    height: calc(6 * var(--u));
    box-sizing: border-box;
    border: 2px solid var(--ink);
    border-radius: var(--r-sm);
    background: var(--paper);
    outline: 3px dashed transparent;
    outline-offset: 3px;
    animation: tour-over 5s infinite;
  }
  .win i {
    display: block;
    height: calc(0.7 * var(--u));
    border-bottom: 2px solid var(--ink);
  }
  .win svg {
    position: absolute;
    inset: calc(1.4 * var(--u)) calc(0.6 * var(--u)) calc(0.5 * var(--u));
    width: calc(100% - calc(1.2 * var(--u)));
    height: calc(100% - calc(1.9 * var(--u)));
    background: var(--canvas);
    border-radius: 3px;
  }
  .line {
    fill: none;
    stroke: var(--ink);
    stroke-width: 3;
    stroke-linecap: round;
    /* The gap is longer than the line and the start is past its end: at
       exactly 1 the round cap of an empty dash stood as a dot. */
    stroke-dasharray: 1 2;
    animation: tour-draw 5s infinite;
  }
  .file {
    position: absolute;
    left: calc(11.2 * var(--u));
    top: calc(3 * var(--u));
    padding: calc(0.25 * var(--u)) calc(0.55 * var(--u));
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--canvas);
    font-size: calc(0.8 * var(--u));
    font-weight: 800;
    animation: tour-drop 5s var(--ease-out) infinite;
  }
  /* The pointer that carries it. */
  .file svg {
    position: absolute;
    right: calc(-0.5 * var(--u));
    bottom: calc(-0.7 * var(--u));
    width: calc(0.85 * var(--u));
    fill: var(--canvas);
    stroke: var(--ink);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  @keyframes tour-drop {
    0% {
      translate: calc(2 * var(--u)) calc(-3.5 * var(--u));
      opacity: 0;
    }
    10% {
      translate: calc(2 * var(--u)) calc(-3.5 * var(--u));
      opacity: 1;
    }
    45% {
      translate: calc(-6.9 * var(--u)) calc(0.4 * var(--u));
      opacity: 1;
      scale: 1;
    }
    55%,
    100% {
      translate: calc(-6.9 * var(--u)) calc(0.4 * var(--u));
      opacity: 0;
      scale: 0.6;
    }
  }
  @keyframes tour-over {
    0%,
    30%,
    56%,
    100% {
      outline-color: transparent;
    }
    38%,
    50% {
      outline-color: var(--accent);
    }
  }
  @keyframes tour-draw {
    0%,
    55% {
      stroke-dashoffset: 1.1;
    }
    80%,
    100% {
      stroke-dashoffset: 0;
    }
  }

  /* a plugin's key joins the row */
  .keys {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc(0.4 * var(--u));
  }
  .k {
    display: grid;
    place-items: center;
    width: calc(2.4 * var(--u));
    height: calc(2.4 * var(--u));
    border-radius: var(--r-sm);
    background: var(--sub);
    color: var(--text);
  }
  .new {
    background: var(--accent);
    color: var(--canvas);
    animation: tour-key 4s var(--ease-out) infinite;
  }
  @keyframes tour-key {
    0%,
    15% {
      translate: 0 calc(-3 * var(--u));
      opacity: 0;
    }
    45%,
    90% {
      translate: 0 0;
      opacity: 1;
    }
    100% {
      translate: 0 0;
      opacity: 0;
    }
  }

  /* frames out to files */
  .strip {
    position: absolute;
    left: calc(1 * var(--u));
    top: calc(2.9 * var(--u));
    width: calc(9 * var(--u));
    display: flex;
    gap: calc(0.3 * var(--u));
  }
  .strip i {
    flex: 1;
    height: calc(2.2 * var(--u));
    box-sizing: border-box;
    border: 2px solid var(--ink);
    border-radius: 4px;
    background: var(--canvas);
  }
  .head {
    position: absolute;
    left: calc(10 * var(--u));
    top: calc(2.4 * var(--u));
    width: 2px;
    height: calc(3.2 * var(--u));
    background: var(--accent);
    animation: tour-head 5s linear infinite;
  }
  .out {
    position: absolute;
    left: calc(11.4 * var(--u));
    top: calc(1.3 * var(--u));
    display: grid;
    gap: calc(0.4 * var(--u));
  }
  .out b {
    padding: calc(0.2 * var(--u)) calc(0.5 * var(--u));
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--canvas);
    font-size: calc(0.75 * var(--u));
    font-weight: 800;
    text-align: center;
  }
  .o1,
  .o2,
  .o3 {
    animation: tour-out 5s var(--ease-out) infinite backwards;
  }
  .o2 {
    animation-delay: 0.25s;
  }
  .o3 {
    animation-delay: 0.5s;
  }
  @keyframes tour-head {
    0% {
      translate: calc(-9 * var(--u)) 0;
    }
    50%,
    100% {
      translate: 0 0;
    }
  }
  @keyframes tour-out {
    0%,
    50% {
      opacity: 0;
      scale: 0.8;
    }
    58%,
    100% {
      opacity: 1;
      scale: 1;
    }
  }

  /* a toon and what was drawn on from it */
  .links {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .l1,
  .l2 {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 1 2;
  }
  .l1 {
    animation: tour-l1 5s infinite;
  }
  .l2 {
    animation: tour-l2 5s infinite;
  }
  .toon {
    position: absolute;
    display: grid;
    place-items: center;
    width: calc(3.6 * var(--u));
    height: calc(2.4 * var(--u));
    box-sizing: border-box;
    border: 2px solid var(--ink);
    border-radius: 5px;
    background: var(--canvas);
    color: var(--ink);
  }
  .t0 {
    left: calc(1.6 * var(--u));
    top: calc(2.8 * var(--u));
  }
  .t1,
  .t2 {
    left: calc(8.8 * var(--u));
    background: var(--tile);
    color: var(--tile-ink);
  }
  .t1 {
    top: calc(0.8 * var(--u));
    animation: tour-t1 5s var(--ease-out) infinite;
  }
  .t2 {
    top: calc(4.8 * var(--u));
    animation: tour-t2 5s var(--ease-out) infinite;
  }
  @keyframes tour-l1 {
    0%,
    10% {
      stroke-dashoffset: 1.1;
    }
    30%,
    100% {
      stroke-dashoffset: 0;
    }
  }
  @keyframes tour-t1 {
    0%,
    28% {
      opacity: 0;
      scale: 0.8;
    }
    38%,
    100% {
      opacity: 1;
      scale: 1;
    }
  }
  @keyframes tour-l2 {
    0%,
    42% {
      stroke-dashoffset: 1.1;
    }
    62%,
    100% {
      stroke-dashoffset: 0;
    }
  }
  @keyframes tour-t2 {
    0%,
    60% {
      opacity: 0;
      scale: 0.8;
    }
    70%,
    100% {
      opacity: 1;
      scale: 1;
    }
  }

  /* the editor, a copy of it changed, the change sent back */
  .fork {
    position: absolute;
    top: calc(1.6 * var(--u));
    left: calc(1.6 * var(--u));
    width: calc(5.4 * var(--u));
    height: calc(4.8 * var(--u));
    box-sizing: border-box;
    border: 2px solid var(--ink);
    border-radius: var(--r-sm);
    background: var(--paper);
  }
  .fork i {
    display: block;
    height: calc(0.6 * var(--u));
    border-bottom: 2px solid var(--ink);
  }
  .fork u {
    position: absolute;
    inset: calc(1.2 * var(--u)) calc(0.4 * var(--u)) calc(0.4 * var(--u)) calc(2.1 * var(--u));
    border-radius: 3px;
    background: var(--canvas);
  }
  .b0,
  .b1 {
    position: absolute;
    left: calc(0.4 * var(--u));
    top: calc(1.2 * var(--u));
    width: calc(1.3 * var(--u));
    height: calc(1.3 * var(--u));
    border-radius: 4px;
    background: var(--accent);
  }
  .f1 {
    left: calc(9 * var(--u));
    animation: tour-f1 6s var(--ease-out) infinite;
  }
  .b1 {
    animation: tour-b1 6s infinite;
  }
  .b0 {
    animation: tour-b0 6s infinite;
  }
  .patch {
    position: absolute;
    left: calc(2.25 * var(--u));
    top: calc(3.05 * var(--u));
    width: calc(0.8 * var(--u));
    height: calc(0.8 * var(--u));
    border-radius: 50%;
    background: var(--accent);
    opacity: 0;
    animation: tour-patch 6s var(--ease-out) infinite;
  }
  @keyframes tour-f1 {
    0%,
    8% {
      opacity: 0;
      translate: calc(-3 * var(--u)) 0;
    }
    22%,
    100% {
      opacity: 1;
      translate: 0 0;
    }
  }
  @keyframes tour-b1 {
    0%,
    30% {
      background: var(--text-2);
    }
    38%,
    100% {
      background: var(--accent);
    }
  }
  @keyframes tour-patch {
    0%,
    44% {
      translate: calc(7.4 * var(--u)) 0;
      opacity: 0;
    }
    48% {
      translate: calc(7.4 * var(--u)) 0;
      opacity: 1;
    }
    66% {
      translate: 0 0;
      opacity: 1;
    }
    72%,
    100% {
      translate: 0 0;
      opacity: 0;
    }
  }
  @keyframes tour-b0 {
    0%,
    66% {
      background: var(--text-2);
    }
    74%,
    100% {
      background: var(--accent);
    }
  }

  /* A key moved from one panel to another */
  .desk {
    position: absolute;
    left: calc(1.5 * var(--u));
    top: calc(1 * var(--u));
    width: calc(13 * var(--u));
    height: calc(6 * var(--u));
    box-sizing: border-box;
    border: 2px solid var(--ink);
    border-radius: var(--r-sm);
    background: var(--sub);
  }
  .leaf {
    position: absolute;
    left: calc(3.6 * var(--u));
    top: calc(0.6 * var(--u));
    width: calc(5.4 * var(--u));
    bottom: calc(0.6 * var(--u));
    background: var(--canvas);
    border-radius: 3px;
  }
  .pan {
    position: absolute;
    left: calc(0.5 * var(--u));
    top: calc(0.6 * var(--u));
    width: calc(2.5 * var(--u));
    bottom: calc(0.6 * var(--u));
    box-sizing: border-box;
    border: 2px solid var(--ink);
    border-radius: 3px;
    background: var(--paper);
  }
  .pan.r {
    left: calc(9.5 * var(--u));
  }
  /* A key that stays in each panel, and the one carried between them. */
  .pan::before,
  .move {
    content: '';
    position: absolute;
    left: calc(0.5 * var(--u));
    top: calc(0.4 * var(--u));
    width: calc(1.2 * var(--u));
    height: calc(1.2 * var(--u));
    border-radius: 3px;
    background: var(--ink);
  }
  .move {
    left: calc(1.15 * var(--u));
    top: calc(2.6 * var(--u));
    background: var(--accent);
    outline: 3px dashed transparent;
    outline-offset: 2px;
    animation: tour-move 5s var(--ease-out) infinite;
  }
  @keyframes tour-move {
    0%,
    15% {
      translate: 0 0;
      outline-color: transparent;
    }
    20% {
      translate: 0 0;
      outline-color: var(--accent);
    }
    40% {
      translate: calc(9 * var(--u)) 0;
      outline-color: var(--accent);
    }
    45%,
    65% {
      translate: calc(9 * var(--u)) 0;
      outline-color: transparent;
    }
    70% {
      translate: calc(9 * var(--u)) 0;
      outline-color: var(--accent);
    }
    90% {
      translate: 0 0;
      outline-color: var(--accent);
    }
    95%,
    100% {
      translate: 0 0;
      outline-color: transparent;
    }
  }

  /* Motion off: every part stands at the end of its road. */
  @media (prefers-reduced-motion: reduce) {
    .art * {
      animation: none;
    }
  }
</style>
