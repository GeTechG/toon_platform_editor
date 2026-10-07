import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// Owner's answers after the fourteenth audit, the system: Safari 16 (iOS 16,
// the last an iPhone 8 or X gets) and Firefox ESR 115 are supported browsers.
// What either lacks is either not written, or written behind a check with a
// way round it. The sources are read as text, as the other guards do: the
// browsers are not in the test run, so the guard is what reaches them.
const LIB = new URL('../', import.meta.url).pathname;

async function sources(pattern: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const path of new Glob(pattern).scan(LIB)) {
    if (path.includes('.test.') || path.startsWith('test-support/')) continue;
    out.push([path, await Bun.file(LIB + path).text()]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

/** A component's or a sheet's CSS, comments out. */
function styleOf(path: string, source: string): string {
  let css = source;
  if (path.endsWith('.svelte')) {
    const open = source.indexOf('<style');
    if (open < 0) return '';
    css = source.slice(source.indexOf('>', open) + 1, source.indexOf('</style>'));
  }
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Rule {
  /** The enclosing at-rule preludes, outermost first. */
  at: string[];
  /** The selector, or null for a rule nested in a style rule. */
  selector: string;
  /** Selectors of the style rules it sits in: non-empty is CSS nesting. */
  parents: string[];
  body: string;
}

/** Every style rule with the at-rules and style rules around it. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const stack: string[] = [];
  const bodies: string[] = [];
  let buf = '';
  for (const ch of css) {
    if (ch === '{') {
      stack.push(buf.trim());
      bodies.push('');
      buf = '';
    } else if (ch === '}') {
      const head = stack.pop()!;
      const body = bodies.pop()! + buf;
      if (!head.startsWith('@') && !/^(from|to|\d+%)/.test(head)) {
        out.push({
          at: stack.filter((s) => s.startsWith('@')),
          selector: head,
          parents: stack.filter((s) => !s.startsWith('@')),
          body,
        });
      }
      buf = '';
    } else if (ch === ';') {
      if (bodies.length) bodies[bodies.length - 1] += buf + ';';
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

const styled = (await sources('**/*.{svelte,css}')).map(([path, source]) => [path, styleOf(path, source)] as const);
/** Script with its comments out: a note that names an API is not a call. */
const scripts = (await sources('**/*.{ts,svelte}')).map(
  ([path, source]) =>
    [
      path,
      (path.endsWith('.svelte') && source.includes('<style') ? source.slice(0, source.indexOf('<style')) : source)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1'),
    ] as const,
);

describe('CSS: what Safari 16 and Firefox 115 read', () => {
  it('no nested rules: Svelte leaves nesting as it is, and Firefox 115 and Safari before 16.5 drop the lot', () => {
    // `:global(:where(.studio.phone)) { .row {…} }` compiled to native
    // nesting; the phone layout was simply absent there.
    const nested = styled.flatMap(([path, css]) =>
      rules(css)
        .filter((rule) => rule.parents.length > 0)
        .map((rule) => `${path}: ${rule.parents.at(-1)} { ${rule.selector} }`),
    );
    expect(nested).toEqual([]);
  });

  it('`:has()` only behind `@supports selector(:has(…))`: Firefox 115 has none, and a rule with it goes whole', () => {
    const bare = styled.flatMap(([path, css]) =>
      rules(css)
        .filter((rule) => rule.selector.includes(':has(') && !rule.at.some((at) => /@supports selector\(:has\(/.test(at)))
        .map((rule) => `${path}: ${rule.selector}`),
    );
    expect(bare).toEqual([]);
  });

  it('`user-select` has its `-webkit-` twin: Safari 16 reads only the prefixed one', () => {
    const lone = styled.flatMap(([path, css]) =>
      rules(css)
        .filter((rule) => /(^|[\s;])user-select:/.test(rule.body) && !rule.body.includes('-webkit-user-select:'))
        .map((rule) => `${path}: ${rule.selector}`),
    );
    expect(lone).toEqual([]);
  });

  it('`:popover-open` stands in a rule of its own: in a list, Safari 16 drops the whole list', () => {
    const listed = styled.flatMap(([path, css]) =>
      rules(css)
        .filter((rule) => rule.selector.includes(':popover-open') && rule.selector.includes(','))
        .map((rule) => `${path}: ${rule.selector}`),
    );
    expect(listed).toEqual([]);
  });

  it('no media range syntax (`width <`): Safari reads it from 16.4 — container queries have it from the start', () => {
    const ranged = styled.flatMap(([path, css]) =>
      [...css.matchAll(/@media[^{]*[<>]/g)].map((m) => `${path}: ${m[0]}`),
    );
    expect(ranged).toEqual([]);
  });

  it('nothing neither browser has', () => {
    const missing = [
      /@starting-style/,
      /transition-behavior/,
      /field-sizing/,
      /light-dark\(/,
      /@scope/,
      /anchor-name|position-anchor|anchor\(/,
      /text-box(-trim|-edge)?:/,
      /\bfrom var\(/, // relative colour: Safari 16.4, Firefox 128
      /[\d.]r?lh\b/,
      /[\d.]cap\b/,
      /(?<![\w-])(round|mod|rem)\(/,
      /interpolate-size|calc-size\(/,
      /@position-try/,
    ];
    const found = styled.flatMap(([path, css]) =>
      missing.filter((re) => re.test(css)).map((re) => `${path}: ${re.source}`),
    );
    expect(found).toEqual([]);
  });
});

describe('script: what Safari 16 and Firefox 115 run', () => {
  it('no call they lack, not even behind a check that is easy to forget', () => {
    const missing: Array<[RegExp, string]> = [
      [/\bObject\.groupBy\b|\bMap\.groupBy\b/, 'groupBy: Safari 17.4, Firefox 119'],
      [/\bPromise\.withResolvers\b/, 'Promise.withResolvers: Safari 17.4, Firefox 121'],
      [/\bPromise\.try\b/, 'Promise.try: Safari 18.2, Firefox 134'],
      [/\bArray\.fromAsync\b/, 'Array.fromAsync: Safari 16.4, Firefox 115 has it, Safari 16.0 not'],
      [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, 'Set methods: Safari 17, Firefox 127'],
      [/\.(isWellFormed|toWellFormed)\(/, 'well-formed strings: Safari 16.4, Firefox 119'],
      [/\bAbortSignal\.any\b/, 'AbortSignal.any: Safari 17.4, Firefox 124'],
      [/\bIterator\.from\b|\.(values|keys|entries)\(\)\s*\.(map|filter|take|drop|flatMap|reduce|toArray|some|every|find|forEach)\(/, 'iterator helpers: Safari 18.4, Firefox 131'],
      [/\bUint8Array\.fromBase64\b|\bUint8Array\.fromHex\b|\.toHex\(\)|\bbytes\.toBase64\(/, 'base64 on Uint8Array: Safari 18.2, Firefox 133'],
      [/\bURL\.(canParse|parse)\(/, 'URL.canParse: Safari 17'],
      [/\.checkVisibility\(/, 'checkVisibility: Safari 17.4'],
      [/\buserActivation\b/, 'navigator.userActivation: Safari 16.4'],
      [/\bImageDecoder\b/, 'ImageDecoder: Safari none'],
      [/\(\?<[=!]/, 'regexp lookbehind: Safari 16.4 (no build can lower it)'],
      [/\/[a-z]*v[a-z]*\.test\(|new RegExp\([^)]*,\s*'[a-z]*v/, 'regexp v flag: Safari 17, Firefox 116'],
      [/\bSymbol\.dispose\b|^\s*(await )?using /m, 'explicit resource management'],
      [/(querySelector(All)?|matches|closest)\(\s*['"`][^'"`]*:has\(/, ':has() in a query throws in Firefox 115'],
    ];
    const found = scripts.flatMap(([path, code]) =>
      missing.filter(([re]) => re.test(code)).map(([, why]) => `${path}: ${why}`),
    );
    expect(found).toEqual([]);
  });

  it('the popover calls sit behind a check for the API, where Safari 16 and Firefox 115 have none', () => {
    const unchecked = scripts
      .filter(([, source]) => /\.(showPopover|hidePopover|togglePopover)\(/.test(source))
      .filter(([, source]) => !/'(showPopover|popover)' in HTMLElement\.prototype/.test(source))
      .map(([path]) => path);
    expect(unchecked).toEqual([]);
  });

  it('requestIdleCallback and scheduler.yield are looked up, not called: Safari has neither', () => {
    const guards: Record<string, RegExp> = {
      requestIdleCallback: /globalThis\.requestIdleCallback \?\?/,
      'scheduler.yield': /scheduler\?\.yield \?/,
    };
    const bare = scripts.flatMap(([path, source]) =>
      Object.entries(guards)
        .filter(([name, guard]) => source.includes(name) && !guard.test(source))
        .map(([name]) => `${path}: ${name}`),
    );
    expect(bare).toEqual([]);
  });

  it('OffscreenCanvas only where it is checked for: Safari has it from 16.4', () => {
    const unchecked = scripts
      .filter(([, source]) => /new OffscreenCanvas\(/.test(source))
      .filter(([, source]) => !/typeof OffscreenCanvas !== 'undefined'/.test(source))
      .map(([path]) => path);
    expect(unchecked).toEqual([]);
  });
});

const read = (name: string) => Bun.file(LIB + 'ui/' + name).text();
const editorUi = await read('Editor.svelte');
const settings = await read('SettingsSheet.svelte');
const colour = await read('ColorPanel.svelte');

describe('the rules that used `:has()` keep working without it', () => {

  it('the strip’s row is marked by the arrangement, not found by the selector', () => {
    expect(editorUi).toContain("class:strip-row={row.includes('timeline')}");
    expect(styleOf('Editor.svelte', editorUi)).toMatch(/\.studio \.row\.strip-row \{[^}]*flex: 1/);
    expect(styleOf('Editor.svelte', editorUi)).toMatch(/\.studio \.row\.strip-row > \.arr\[data-item='timeline'\]/);
  });

  it('an arrange handle with nothing drawn in it is marked empty by the markup it holds', () => {
    expect(editorUi).toMatch(/class="arr-body" inert use:markEmpty>/);
    expect(styleOf('Editor.svelte', editorUi)).toMatch(/\.editor\.arranging \.arr:global\(\[data-empty\]\) \{\s*display: none/);
  });

  it('a settings label with a note under it says so by a class', () => {
    const withNote = [...settings.matchAll(/<span class="toggle-label([^"]*)">[^<]*<small/g)];
    expect(withNote.length).toBe(3);
    for (const m of withNote) expect(m[1]).toBe(' stacked');
    expect(styleOf('SettingsSheet.svelte', settings)).toMatch(/\.toggle \.toggle-label\.stacked \{[^}]*flex-direction: column/);
  });

  it('the colour swatch shows its ring by `:focus-within` where `:has()` is missing', () => {
    expect(styleOf('ColorPanel.svelte', colour)).toMatch(/@supports not selector\(:has\(\*\)\) \{\s*\.color:focus-within \{/);
  });
});
