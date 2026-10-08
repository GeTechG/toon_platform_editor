import { describe, expect, it } from 'bun:test';

// The motion of the studio's shell: the chrome only answers the hand — a
// press, a change of tone, a box arriving from the key that called it — on the
// tokens of tokens.css. Components are asserted as source, like the audits.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const names = ['Editor.svelte', 'controls.css', 'FloatWindow.svelte', 'PanelArranger.svelte', 'PopKey.svelte', 'Dropdown.svelte', 'ToolKey.svelte', 'CanvasView.svelte'];
const shell = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await read(`./${name}`)] as const)));
/** The style of a file: the whole of a .css, the <style> block of a component. */
const css = (name: string) => (name.endsWith('.css') ? shell[name] : shell[name].slice(shell[name].lastIndexOf('<style')));

const ARRIVAL = 'animation: studio-pop var(--dur-enter) var(--ease-out);';

describe('what arrives in the shell arrives one way', () => {
  it('one keyframe, opacity and a few pixels from the side of its key', () => {
    const frames = css('controls.css').match(/@keyframes studio-pop \{[^]*?\n\}/)?.[0] ?? '';
    expect(frames).toContain('opacity: 0;');
    expect(frames).toContain('translate: 0 var(--pop-from, -4px);');
    // Nothing a software renderer lays out or blurs.
    expect(frames).not.toMatch(/width|height|top|left|margin|filter|scale/);
  });

  it('reduced motion takes the travel and keeps the fade', () => {
    // The same name, declared again where motion is reduced: no travel in it.
    expect(css('controls.css')).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*@keyframes studio-pop \{\s*from \{\s*opacity: 0;\s*\}\s*\}\s*\}/);
  });

  it.each([
    ['PopKey.svelte', '.pop-plate'],
    ['Dropdown.svelte', '.list:popover-open'],
    ['Editor.svelte', '.more-window'],
    ['PanelArranger.svelte', '.arrange-bar'],
    ['FloatWindow.svelte', '.float.born'],
  ])('%s: %s', (name, selector) => {
    const rule = css(name).match(new RegExp(`\\n  ${selector.replace(/[.:]/g, '\\$&')} \\{[^}]*\\}`))?.[0] ?? '';
    expect(rule).toContain(ARRIVAL);
    // Its own side, named: the property inherits, and a list in a sheet took the sheet's.
    expect(rule).toMatch(/--pop-from: (-4|0)px;/);
  });

  it('a box opened over its key comes up from it, not down', () => {
    expect(shell['PopKey.svelte']).toContain('class:up={at?.bottom !== undefined}');
    expect(css('PopKey.svelte')).toMatch(/\.pop-plate\.up \{\s*--pop-from: 4px;/);
    expect(shell['Dropdown.svelte']).toContain('class:up={at.up}');
    expect(css('Dropdown.svelte')).toMatch(/\.list\.up:popover-open \{\s*--pop-from: 4px;/);
  });

  it('a window has no key to come from: it only fades', () => {
    expect(css('FloatWindow.svelte')).toMatch(/\.float\.born \{[^}]*--pop-from: 0px;/);
  });

  it('a window the layout kept stands with the studio: only one pulled out by hand fades', () => {
    expect(shell['FloatWindow.svelte']).toContain('const born = untrack(() => editor.arranging);');
    expect(css('FloatWindow.svelte')).not.toMatch(/\n  \.float \{[^}]*animation:/);
  });

  it("the studio's own sheets arrive as the settings do", () => {
    expect(css('Editor.svelte')).toMatch(/\n  \.sheet-dialog \{\s*--pop-from: 0px;\s*animation: studio-pop var\(--dur-enter\) var\(--ease-out\);/);
  });
});

describe('the shell moves on the tokens', () => {
  it.each(names)('%s: no `transition: all`, no duration written out', (name) => {
    const style = css(name);
    expect(style).not.toMatch(/transition:\s*all/);
    // The save plate's four seconds are how long it is read, not a motion.
    const moving = style.match(/(transition|animation):[^;]*;/g)?.filter((line) => !line.includes('saved-note')) ?? [];
    for (const line of moving) expect(line).not.toMatch(/\d(ms|s)\b/);
  });

  it('the key squeezes fast and changes tone at the pace of a state', () => {
    expect(css('Editor.svelte')).toMatch(/transform var\(--dur-fast\) var\(--ease-out\),\s*background var\(--dur\) var\(--ease-out\),\s*color var\(--dur\) var\(--ease-out\);/);
  });

  it('reduced motion keeps the tone of a key and of a switch, not the squeeze or the knob’s travel', () => {
    const still = css('Editor.svelte').match(/@media \(prefers-reduced-motion: reduce\) \{[^]*?\n  \}/)?.[0] ?? '';
    expect(still).toContain('transition: background var(--dur) var(--ease-out), color var(--dur) var(--ease-out);');
    expect(still).toMatch(/\.key:active:not\(:disabled\)\) \{\s*transform: none;/);
    const knob = css('controls.css').match(/@media \(prefers-reduced-motion: reduce\) \{\s*:where\(\.editor\) input[^]*?\n\}/)?.[0] ?? '';
    expect(knob).toContain('transition: background-color var(--dur), border-color var(--dur);');
    expect(knob).not.toContain('background-position');
  });
});
