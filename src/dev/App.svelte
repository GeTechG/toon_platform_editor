<script lang="ts">
  import Editor from '../lib/ui/Editor.svelte';
</script>

<main>
  <Editor />
</main>

<style>
  :global(body) {
    margin: 0;
    background: #161616;
  }
  main {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
</style>
