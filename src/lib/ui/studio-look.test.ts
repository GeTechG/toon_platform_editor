import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// The studio wears the site's look (web-look «Студия в том же виде»): one
// palette in the shared table, a red accent, flat pill keys, the host's face.
const UI = new URL('./', import.meta.url).pathname;
const tokensCss = await Bun.file(UI + 'tokens.css').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const sheets: { file: string; text: string }[] = [];
for await (const file of new Glob('*.svelte').scan(UI)) {
  sheets.push({ file, text: await Bun.file(UI + file).text() });
}

/** The body of the first rule whose selector is exactly `sel`. */
function rule(css: string, sel: string): string {
  const at = css.indexOf(sel + ' {');
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('one palette for the site and the studio', () => {
  it('the shared table carries the rounded look', () => {
    expect(tokensCss).toContain('--text: #1a1f2e;');
    expect(tokensCss).toContain('--text-2: #535b6e;');
    expect(tokensCss).toContain('--sub: #dae1f0;');
    expect(tokensCss).toContain('--well: #f4f6fb;');
    expect(tokensCss).toContain('--accent: var(--signal-dark);');
    expect(tokensCss).toContain('--accent-ink: var(--signal-deep);');
    expect(tokensCss).toContain('--feather: 0 0 1px 0.25px;');
    // The name only: the files are the host's (the site ships M PLUS), so an
    // embed elsewhere falls through to a system rounded face.
    expect(tokensCss).toContain("--font-body: 'M PLUS Rounded 1c', ui-rounded, system-ui, sans-serif;");
  });

  it('the focus ring is the accent', () => {
    expect(tokensCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent\)/s);
  });
});

describe('red is the studio accent', () => {
  it('electric is left to the drawing aids only', () => {
    // The first layer tag is a data colour; onion-skin is `--ghost-2`.
    const hits = sheets.flatMap(({ file, text }) =>
      text
        .split('\n')
        .filter((l) => l.includes('var(--electric') && !l.includes('--layer-tag-0:'))
        .map((l) => `${file}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('the studio key is a flat pill', () => {
  it('has no hard key shadow anywhere in the studio', () => {
    const keys = sheets.flatMap(({ file, text }) =>
      [...text.matchAll(/box-shadow:\s*0 \d+px 0 [^;]*;/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(keys).toEqual([]);
  });

  it('is a borderless capsule that squeezes on press', () => {
    const key = rule(editorUi, '.editor :global(.key)');
    expect(key).toContain('border: none;');
    expect(key).toContain('border-radius: var(--r-pill);');
    expect(rule(editorUi, '.editor :global(.key:active:not(:disabled))')).toContain('transform: scale(0.96);');
  });

  it('the picked key and the primary take the accent', () => {
    expect(rule(editorUi, '.editor :global(.key.active)')).toContain('var(--accent)');
    expect(rule(editorUi, '.editor :global(.key.primary)')).toContain('background: var(--accent);');
  });

  it('does not squeeze under reduced motion', () => {
    const reduced = editorUi.slice(editorUi.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/:global\(\.key:active:not\(:disabled\)\)[^{]*\{\s*transform: none;/s);
  });
});

describe('the studio sets the host face', () => {
  it('reads the body font and the site text ink', () => {
    const root = rule(editorUi, '.editor');
    expect(root).toContain('font-family: var(--font-body);');
    expect(root).toContain('color: var(--text);');
  });
});

describe('what lies in the studio is flat', () => {
  // A plate is told from the paper by tone; a drawing's thumbnail and a data
  // cell keep their hairline, and a field keeps its 3:1 edge (WCAG 1.4.11).
  const PLATES: [string, string][] = [
    ['BrushPanel.svelte', '.box'],
    ['BrushPanel.svelte', '.types'],
    ['BrushPanel.svelte', '.live'],
    ['BrushPanel.svelte', '.note'],
    ['BrushPanel.svelte', '.trigger'],
    ['PaletteBox.svelte', '.box'],
    ['PaletteBox.svelte', '.swap'],
    ['AudioPanel.svelte', '.audio-plate'],
    ['ColourPicker.svelte', '.picker'],
    ['PanelArranger.svelte', '.arrange-bar'],
    ['PanelArranger.svelte', '.chip'],
    ['FloatWindow.svelte', '.float'],
    ['TransformMenu.svelte', '.transform-menu'],
    ['ScaleMenu.svelte', '.scale-menu'],
    ['SettingsSheet.svelte', '.preset-chip'],
    ['Timeline.svelte', '.body'],
    ['Editor.svelte', '.pick-window'],
  ];

  it('draws no line round a plate or a chip', () => {
    const lined = PLATES.filter(([file, sel]) => {
      const text = sheets.find((s) => s.file === file)!.text;
      const at = text.indexOf(`\n  ${sel} {`);
      expect(at).toBeGreaterThan(-1);
      return /\bborder:\s*1px solid/.test(text.slice(at, text.indexOf('}', at)));
    });
    expect(lined).toEqual([]);
  });

  it('lights what is under the cursor in the sub-surface tone', () => {
    const sky = sheets.filter(({ text }) => text.includes('var(--sky)')).map(({ file }) => file);
    expect(sky).toEqual([]);
  });
});
