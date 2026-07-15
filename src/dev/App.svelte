<script lang="ts">
  import Editor from '../lib/ui/Editor.svelte';
</script>

<main>
  <h1>toon-editor <span class="dev">dev</span></h1>
  <Editor />
</main>

<style>
  main {
    max-width: 900px;
    height: 100dvh;
    margin: 0 auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  h1 {
    font-size: 1.1rem;
    margin: 0.25rem 0 0.5rem;
  }
  .dev {
    font-size: 0.7rem;
    color: #999;
    vertical-align: super;
  }
</style>
