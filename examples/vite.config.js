// Plugins are independent: one ES module, whatever is inside it is its own
// business. A plugin without dependencies needs no build at all — the source
// file is what ships. This is for the other case: a plugin that pulls
// something in and has to arrive as one file anyway.
import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('./shift/', import.meta.url).pathname,
  build: {
    outDir: new URL('./dist/shift/', import.meta.url).pathname,
    emptyOutDir: true,
    lib: { entry: 'index.js', formats: ['es'], fileName: () => 'index.js' },
  },
});
