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

  let { editor }: { editor: EditorState } = $props();
  // The column folded, or the layout changed, under the hand: the ring must not stay.
  onDestroy(() => (editor.sizeShown = false));

  const min = $derived(editor.brushRange.min);
  const max = $derived(editor.brushSizeMax);
  const size = $derived(editor.brushSizeLogical);
</script>

<div class="brush-rail" role="group" aria-label={t('brush.box')}>
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
        aria-orientation="vertical"
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
  }
  .now {
    font-size: 0.8rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
  }
  /* The room the turned slider stands in: a key wide, nine rem tall. */
  .well {
    position: relative;
    width: var(--key-h);
    height: 9rem;
  }
  /* Turned, not `writing-mode: vertical-lr`: Safari 16 lays that one down. */
  .well input {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 9rem;
    height: var(--key-h);
    margin: 0;
    transform: translate(-50%, -50%) rotate(-90deg);
  }
</style>
