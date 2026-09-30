import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';
import { pickerAccept } from './file-accept';

// Owner answers after the fifteenth audit, the shared system. Asserted as
// source, like audit15-system: the phones are not in the run.
const UI = new URL('./', import.meta.url).pathname;
const LIB = new URL('../', import.meta.url).pathname;
const text = (path: string) => Bun.file(path).text();

/** Every component's and sheet's CSS, comments out. */
async function styles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const path of new Glob('**/*.{svelte,css}').scan(LIB)) {
    let css = await text(LIB + path);
    if (path.endsWith('.svelte')) {
      const open = css.indexOf('<style');
      if (open < 0) continue;
      css = css.slice(css.indexOf('>', open) + 1, css.indexOf('</style>'));
    }
    out.push([path, css.replace(/\/\*[\s\S]*?\*\//g, '')]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

/** The selectors with `:hover` that no `@media (hover: hover)` holds. */
function unguardedHovers(css: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let prelude = '';
  for (const ch of css) {
    if (ch === '{') {
      const head = prelude.trim();
      if (head.includes(':hover') && !open.some((at) => /\(hover:\s*hover\)/.test(at))) out.push(head);
      open.push(head);
      prelude = '';
    } else if (ch === '}') {
      open.pop();
      prelude = '';
    } else if (ch === ';') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return out;
}

describe('a hover tone is only for a pointer that hovers', () => {
  // A touch «hover» sticks after a tap: a fold, a chip or a swatch kept the
  // tone of a press that was over. `.tab` and `.key` had it; now every rule.
  it('the reader finds a bare hover and passes a guarded one', () => {
    expect(unguardedHovers('.a:hover { color: red; }')).toEqual(['.a:hover']);
    expect(unguardedHovers('@media (hover: hover) { .a:hover { color: red; } }')).toEqual([]);
    expect(unguardedHovers('@supports x { @media (hover: hover) { .a:hover { b: c } } } .d:hover { e: f }')).toEqual([
      '.d:hover',
    ]);
  });

  it('no stylesheet of the editor has one outside the guard', async () => {
    const bare = (await styles()).flatMap(([path, css]) => unguardedHovers(css).map((head) => `${path}: ${head}`));
    expect(bare).toEqual([]);
  });

  it('the remover mark shows on every cell where nothing hovers', async () => {
    // It came up under the pointer alone: on a touch screen, remove mode
    // said nothing on the cells it was about to take.
    const box = await text(UI + 'PaletteBox.svelte');
    const css = box.slice(box.indexOf('<style'));
    const guard = css.indexOf('@media (hover: hover)', css.indexOf('.grid.remover .cell {'));
    expect(guard).toBeGreaterThan(0);
    expect(css.indexOf('.grid.remover .cell :global(svg) {')).toBeGreaterThan(guard);
  });
});

describe('the file picker lets a .toonop be picked on an iPhone', () => {
  // WebKit on iOS (WKFileUploadPanel) turns each accepted extension into a MIME
  // type and drops one it has none for: `.toonop,.toon,.json` became JSON
  // alone, and the document picker greyed out every mult file.
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 };
  const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 };
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 };
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 };

  it('on iOS and iPadOS the picker takes any file', () => {
    expect(pickerAccept('.toonop,.toon,.json', iphone)).toBeUndefined();
    expect(pickerAccept('.toonop,.toon,.json', ipad)).toBeUndefined();
  });

  it('elsewhere the list stays', () => {
    expect(pickerAccept('.toonop,.toon,.json', mac)).toBe('.toonop,.toon,.json');
    expect(pickerAccept('.toonop,.toon,.json', android)).toBe('.toonop,.toon,.json');
    expect(pickerAccept('.toonop,.toon,.json', undefined)).toBe('.toonop,.toon,.json');
  });

  it('the pickers with our own extensions ask it', async () => {
    expect(await text(UI + 'Editor.svelte')).toContain("accept={pickerAccept('.toonop,.toon,.json')}");
    expect(await text(UI + 'SettingsSheet.svelte')).toContain(
      "accept={pickerAccept('.toonops,.toonio,application/json,.json')}",
    );
  });
});

describe('the whole-frame copy is gone with its keys', () => {
  // C/V copied and replaced the active frame across every layer (July). The
  // studio timeline moved C/V to the cell selection; when the bar layout went
  // (one setup for every preset) the last call went with it, and only tests
  // kept the two methods alive.
  it('the state has no frame copy or frame paste', async () => {
    const state = await text(UI + 'editor-state.svelte.ts');
    expect(state).not.toContain('copyActiveFrame');
    expect(state).not.toContain('pasteFrame');
    expect(state).not.toContain('copiedColumn');
  });

  it('the model has no column copy', async () => {
    const ops = await text(LIB + 'model/operations.ts');
    expect(ops).not.toContain('cloneColumn');
    expect(ops).not.toContain('replaceColumn');
  });
});
