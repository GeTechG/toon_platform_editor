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

  it('a plain key on a white sheet is a ghost capsule, not bare text', () => {
    expect(rule(editorUi, '.editor :global(.sheet .key:not(.primary):not(.active))')).toContain('background: var(--sub);');
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

describe('a draft row gives its words the room', () => {
  // The row is a phone-width sheet: three 44px keys with gaps between them left
  // the date two lines and the size line three.
  it('writes the date to the minute, on one line', () => {
    expect(editorUi).toContain("toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' })");
    expect(rule(editorUi, '.draft-date')).toContain('white-space: nowrap;');
  });

  it('packs the row keys shoulder to shoulder', () => {
    expect(rule(editorUi, '.draft')).toContain('gap: 0;');
  });

  it('leaves the icon keys bare, their hover circle smaller than the target', () => {
    // Once the sheet keys took the ghost fill, three 44px circles stood rim
    // to rim. The press area stays 44; the drawn circle is the content box.
    const body = rule(editorUi, '.editor .draft .key.icon');
    expect(body).toContain('background: none;');
    expect(body).toContain('background-clip: content-box;');
    expect(body).toMatch(/padding: \d/);
  });
});

describe('nothing that lies in the studio casts a soft shadow', () => {
  // As on the site, only what drops over the work keeps its shadow: menus, the
  // popover note, the panel being dragged, the modal sheets. Plates, windows,
  // the zoom window and the paper itself are told apart by tone.
  const FLOATS = new Set([
    'BrushPanel.svelte .types',
    'BrushPanel.svelte .note',
    'ColourPicker.svelte .picker',
    'PanelArranger.svelte .ghost',
    'Timeline.svelte .frame-menu',
    'Editor.svelte .editor :global(.sheet)',
  ]);

  it('keeps soft shadows for what drops over the work', () => {
    const cast: string[] = [];
    for (const { file, text } of sheets) {
      const style = text.slice(text.indexOf('<style'));
      for (const m of style.matchAll(/box-shadow:\s*var\(--shadow-/g)) {
        const open = style.lastIndexOf('{', m.index);
        const sel = style.slice(style.lastIndexOf('\n', open) + 1, open).trim();
        if (!FLOATS.has(`${file} ${sel}`)) cast.push(`${file} ${sel}`);
      }
    }
    expect(cast).toEqual([]);
  });

  it('lays the paper on the table without a shadow', async () => {
    const view = await Bun.file(UI + 'CanvasView.svelte').text();
    expect(view).not.toContain('shadowBlur =');
    expect(view).not.toContain('shadowColor =');
  });
});

describe('what lies over the stage has no ring', () => {
  // The hairline ring did not fit the look (owner, 2026-09-23): windows over
  // the stage are told apart by tone alone.
  it('draws no ring round the stage windows', () => {
    expect(editorUi).not.toContain('.scale-window > :global(*) {');
    const float = sheets.find((s) => s.file === 'FloatWindow.svelte')!.text;
    expect(float).not.toContain('0 0 0 1px var(--hairline)');
  });
});

describe('nothing scrolls that should not', () => {
  const palette = () => sheets.find((s) => s.file === 'PaletteBox.svelte')!.text;

  it('gives the palette footer the height its 44px keys take', () => {
    // A 40px track under a 44px floor (+1px rule) made the whole box scroll by 5px.
    expect(rule(palette(), '\n  .palette')).toContain('grid-template-rows: auto minmax(32px, 1fr) auto;');
  });

  it('marks a picked palette tool in the accent, not the onion-skin blue', () => {
    expect(rule(palette(), '.foot-btn.active')).not.toContain('--ghost-2');
  });
});
