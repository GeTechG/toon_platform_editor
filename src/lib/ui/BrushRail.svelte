<script lang="ts">
  /**
   * The brush beside the canvas (toonop's sidebar, after Procreate Dreams'):
   * thickness as a slider standing up, the number over it. While a hand is
   * on it the canvas shows the size as a ring in the middle of the stage
   * (`editor.sizeShown`) — the ring alone, no caption. The rest of the brush — type, smoothing, the exact numbers — stays in the
   * brush box, behind the tool's own key.
   */
  import type { EditorState } from './editor-state.svelte';
  import { SIZE_TRACK, positionOfSize, sizeAtPosition, sizeByKey } from './size-scale';
  import { t } from '../i18n';

  import { onDestroy } from 'svelte';

  /** `lying`: the widget lies along the stage's foot (a screen standing up) — the number, then a lying range. */
  let { editor, lying = false }: { editor: EditorState; lying?: boolean } = $props();
  // The column folded, or the layout changed, under the hand: the ring must not stay.
  onDestroy(() => (editor.sizeShown = false));

  const min = $derived(editor.brushRange.min);
  const max = $derived(editor.brushSizeMax);
  const size = $derived(editor.brushSizeLogical);
</script>

<div class="brush-rail" class:lying role="group" aria-label={t('brush.box')}>
  <!-- The number over it: what the slider holds now. The track is a lying
       range turned on its end — up is more, and the arrows agree. -->
  <label class="v" title={t('brush.thickness')}>
    <span class="now" aria-hidden="true">{size}</span>
    <span class="well">
      <!-- The logarithmic track of the brush box (size-scale.ts), key for key. -->
      <input
        type="range"
        min="0"
        max={SIZE_TRACK}
        step="any"
        value={Math.round(positionOfSize(size, min, max))}
        aria-label={t('brush.sizes_group')}
        aria-orientation={lying ? 'horizontal' : 'vertical'}
        aria-valuetext={t('brush.size_value', { count: size })}
        onpointerdown={() => (editor.sizeShown = true)}
        onpointerup={() => (editor.sizeShown = false)}
        onpointercancel={() => (editor.sizeShown = false)}
        onkeyup={() => (editor.sizeShown = false)}
        onblur={() => (editor.sizeShown = false)}
        oninput={(e) => (editor.brushSizeLogical = sizeAtPosition(e.currentTarget.valueAsNumber, min, max))}
        onchange={(e) => (e.currentTarget.value = String(Math.round(positionOfSize(size, min, max))))}
        onkeydown={(e) => {
          const next = sizeByKey(e.key, size, min, max, editor.ux);
          if (next === null) return;
          e.preventDefault();
          editor.brushSizeLogical = next;
          editor.sizeShown = true;
        }}
      />
    </span>
  </label>
</div>

<style>
  .brush-rail {
    /* How tall the turned slider stands; a phone lying down has less (Editor.svelte). */
    --rail-h: 9rem;
    display: flex;
    justify-content: center;
    gap: 0.4rem;
  }
  .v {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    width: var(--key-h);
    min-height: 0;
  }
  .now {
    font-size: 0.8rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
  }
  /* The room the turned slider stands in: a key wide, nine rem tall — less
     where the sidebar under a desk's tools has less (Editor.svelte), never
     under three. */
  .well {
    position: relative;
    flex: 0 1 var(--rail-h);
    min-height: min(3rem, var(--rail-h));
    width: var(--key-h);
    container-type: size;
  }
  /* Turned, not `writing-mode: vertical-lr`: Safari 16 lays that one down. */
  .well input {
    position: absolute;
    left: 50%;
    top: 50%;
    /* As long as the room is tall, whatever it shrank to. */
    width: var(--rail-h);
    width: 100cqh;
    height: var(--key-h);
    margin: 0;
    transform: translate(-50%, -50%) rotate(-90deg);
    /* The finger's whole travel is the slider's: where the page could pan,
       the browser took the drag, cancelled the pointer, and the size ring
       on the canvas went a moment after it came. */
    touch-action: none;
  }
  /* Lying: the range as it is made, the number before it. */
  .brush-rail.lying,
  .brush-rail.lying .v {
    flex: 1 1 auto;
    min-width: 0;
  }
  .brush-rail.lying .v {
    flex-direction: row;
    gap: 0.4rem;
    width: auto;
  }
  .brush-rail.lying .now {
    min-width: 2ch;
    text-align: center;
  }
  .brush-rail.lying .well {
    /* Fourteen rem where the stage has them, what it has where it has not. */
    flex: 0 1 auto;
    min-width: 4rem;
    min-height: 0;
    width: 14rem;
    height: var(--key-h);
  }
  .brush-rail.lying .well input {
    position: static;
    width: 100%;
    transform: none;
  }
</style>
