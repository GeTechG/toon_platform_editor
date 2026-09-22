import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// A `var(--x, fallback)` whose token was never declared does not fall back — the
// fallback *is* what ships, every time, and it is never the token's value. Two
// of them were live: `--ink-muted` put #6b7280 on the frame ruler (4.44:1, under
// AA) and `--paper-2` put a neutral black wash under a hovered brush type. The
// scan below is the guard: a token either exists or the reference is a bug.
const UI = new URL('../../', import.meta.url).pathname;

async function uiFiles(): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = [];
  for await (const file of new Glob('**/*.{svelte,css}').scan(UI)) {
    out.push({ file, text: await Bun.file(UI + file).text() });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const files = await uiFiles();

/** Names declared anywhere in the package — in CSS, or bound inline by Svelte. */
function declared(): Set<string> {
  const names = new Set<string>();
  for (const { text } of files) {
    for (const [, name] of text.matchAll(/(?:^|[\s;{])(--[a-zA-Z0-9-]+)\s*:/gm)) {
      names.add(name);
    }
    // `style:--swatch={color}` — a value the markup hands the element itself.
    for (const [, name] of text.matchAll(/style:(--[a-zA-Z0-9-]+)=/g)) {
      names.add(name);
    }
  }
  return names;
}

/** Every `var(--x)` reference, with the file that makes it. */
function used(): { file: string; name: string; fallback: string | null }[] {
  const out: { file: string; name: string; fallback: string | null }[] = [];
  for (const { file, text } of files) {
    for (const [, name, fallback] of text.matchAll(/var\((--[a-zA-Z0-9-]+)(?:,\s*([^)]*(?:\([^)]*\))?[^)]*))?\)/g)) {
      out.push({ file, name, fallback: fallback?.trim() ?? null });
    }
  }
  return out;
}

const DECLARED = declared();

/** An interpolated name (`var(--layer-tag-{i})`) reads as a prefix. */
function isDeclared(name: string): boolean {
  if (DECLARED.has(name)) {
    return true;
  }
  return name.endsWith('-') && [...DECLARED].some((d) => d.startsWith(name));
}

describe('every token a component names exists', () => {
  it('no component falls back to a value no token declares', () => {
    const orphans = used()
      .filter(({ name }) => !isDeclared(name))
      .map(({ file, name }) => `${file}: ${name}`);
    expect([...new Set(orphans)].sort()).toEqual([]);
  });
});

// A fallback is not decoration: `Player` and `Icon` ship as their own entry
// points and render outside `.editor`, where the tokens do not inherit. So the
// fallback has to *be* the token — sixteen of them carried #2f5bff and #2f6fed,
// neither of which is the bloodline blue, plus a warm #555 for the cool
// secondary ink and 5px/6px for the 7px corner. Dead while inherited, wrong the
// moment a component renders on its own.
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;

function normalise(value: string): string {
  const v = value.trim().toLowerCase();
  const short = v.match(SHORT_HEX);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : v;
}

/** The value each token is declared with, where the package declares it once. */
function declaredValues(): Map<string, string> {
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (const { text } of files) {
    for (const [, name, value] of text.matchAll(/(?:^|[\s;{])(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/gm)) {
      const v = normalise(value.split('/*')[0]);
      if (seen.has(name) && values.get(name) !== v) {
        values.delete(name); // declared more than one way — nothing to check against
      } else {
        values.set(name, v);
      }
      seen.add(name);
    }
  }
  return values;
}

describe('a fallback carries the token it stands in for', () => {
  it('no component falls back to a value the system does not use', () => {
    const values = declaredValues();
    const wrong = used()
      .filter(({ name, fallback }) => {
        if (fallback === null || !values.has(name)) {
          return false;
        }
        return normalise(fallback) !== values.get(name);
      })
      .map(({ file, name, fallback }) => `${file}: var(${name}, ${fallback}) — token is ${values.get(name)}`);
    expect([...new Set(wrong)].sort()).toEqual([]);
  });
});

// The table was written out twice — once on `.editor` here, once on `:root` in
// the site's app.css — so a hue changed in one place left the editor and the
// page it sits in disagreeing. It lives in one file now, and both read it.
const tokensCss = await Bun.file(new URL('./tokens.css', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('the brand table is written once', () => {
  it('the palette lives in tokens.css', () => {
    expect(tokensCss).toContain('--electric: #1b5cff');
    expect(tokensCss).toContain('--signal: #ff4326');
    expect(tokensCss).toContain('--paper: #eaeef7');
    // Zero specificity, so a host that embeds the editor and has its own --ink
    // keeps it: the file offers the tokens, it does not impose them.
    expect(tokensCss).toContain(':where(.editor, :root)');
  });

  it('the editor reads the file instead of restating it', () => {
    expect(editorUi).toContain("import './tokens.css'");
    expect(editorUi).not.toMatch(/--electric:\s*#/);
    expect(editorUi).not.toMatch(/--signal:\s*#/);
    expect(editorUi).not.toMatch(/--paper:\s*#/);
  });

  it('what only the editor needs stays with the editor', () => {
    // The worktable tone, the key height and the bleed are chrome, not brand.
    expect(editorUi).toMatch(/--table:\s*#/);
    expect(editorUi).toContain('--key-h:');
    expect(editorUi).toContain('--bleed: 6px;');
  });
});

// The layers that stand over the canvas all share the editor's one stacking
// context, and their order lived in nine literals across six files — 3, 5, 6,
// 11, 30, 40 — with nothing saying which was meant to be above which. A new
// overlay was placed by guesswork. The order is written once now; a number
// inside a component that only orders its own children stays a number.
describe('the overlays over the canvas stack by name', () => {
  const LADDER = ['--z-tool', '--z-flash', '--z-float', '--z-sheet', '--z-arrange', '--z-cursor', '--z-drop'];
  const tokens = files.find((f) => f.file.endsWith('ui/tokens.css'))!.text;

  it('the ladder is declared once, bottom to top', () => {
    const values = LADDER.map((name) => Number(tokens.match(new RegExp(`${name}:\\s*(\\d+)`))?.[1]));
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it('every overlay takes its rung', () => {
    const uses: [string, string, string][] = [
      ['ui/Editor.svelte', '.tool-windows', '--z-tool'],
      ['ui/Editor.svelte', '.scale-window', '--z-tool'],
      ['ui/Editor.svelte', '.flash', '--z-flash'],
      ['ui/FloatWindow.svelte', '.float', '--z-float'],
      ['ui/AudioPanel.svelte', '.audio-plate', '--z-float'],
      ['ui/Editor.svelte', '.editor :global(.sheet)', '--z-sheet'],
      ['ui/CanvasView.svelte', '.brush-cursor', '--z-cursor'],
      ['ui/CanvasView.svelte', '.pick-preview', '--z-cursor'],
      ['ui/PanelArranger.svelte', '.arrange-bar', '--z-arrange'],
      ['ui/PanelArranger.svelte', '.drop-panel', '--z-drop'],
    ];
    for (const [file, selector, rung] of uses) {
      const text = files.find((f) => f.file.endsWith(file))!.text;
      const at = text.indexOf(`  ${selector} {`);
      expect(at).toBeGreaterThan(-1);
      expect(text.slice(at, text.indexOf('}', at))).toContain(`z-index: var(${rung})`);
    }
  });
});

// Inside the editor every component renders under `.editor`, where tokens.css
// declares the whole table. A hex fallback there is never used — it is a copy
// of the token's value that goes stale the day the hue moves, and in a host
// with its own table it would hide a missing token instead of showing it. The
// standalone player is the one export that is mounted without tokens.css.
describe('an editor component reads a token without a copy of its value', () => {
  it('no var(--token, #hex) outside the player', () => {
    const copies = files
      .filter((f) => f.file.startsWith('lib/ui/') && f.file.endsWith('.svelte'))
      .flatMap((f) => [...f.text.matchAll(/var\(--[a-z0-9-]+,\s*#[0-9a-f]{3,8}\)/gi)].map((m) => `${f.file}: ${m[0]}`));
    expect(copies).toEqual([]);
  });

  it('the first layer tag is the electric blue by name, not by value', () => {
    const editor = files.find((f) => f.file === 'lib/ui/Editor.svelte')!.text;
    expect(editor).toContain('--layer-tag-0: var(--electric);');
  });
});

// The radius scale is five rungs (DESIGN §2). A literal that equals a rung is
// the rung written by hand; 10px and 6px are no rung at all — three tool
// windows sat at 10 beside a brush box at 14. What stays literal is drawing
// detail under the scale: a 2px stripe, a 4px thumbnail corner.
describe('a corner is a rung of the radius scale', () => {
  it('no literal radius at or above the smallest rung', () => {
    const literals = files
      .filter((f) => f.file.startsWith('lib/ui/') && f.file.endsWith('.svelte'))
      .flatMap((f) =>
        [...f.text.matchAll(/border-radius:\s*(\d+)px;/g)]
          .filter((m) => Number(m[1]) >= 6)
          .map((m) => `${f.file}: ${m[0]}`),
      );
    expect(literals).toEqual([]);
  });
});
