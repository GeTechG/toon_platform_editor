import { expect, test } from 'bun:test';

/**
 * The template has no dependencies, so the file is what ships. The build is
 * here for the plugin that does pull something in — this checks the config
 * still works and that the template itself stays a plain, self-contained
 * module.
 */
test('the template is one self-contained module', async () => {
  const run = Bun.spawn(['bunx', 'vite', 'build', '--config', 'examples/vite.config.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await run.exited).toBe(0);

  const bundle = await Bun.file(new URL('./dist/shift/index.js', import.meta.url)).text();
  expect(bundle).not.toContain('import');
  expect(bundle.length).toBeLessThan(2_000);
}, 30_000);
