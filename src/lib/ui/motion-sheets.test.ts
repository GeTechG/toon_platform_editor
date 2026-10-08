import { describe, expect, it } from 'bun:test';

// The motion of the studio's sheets and tool panels: what arrives fades in on
// the shell's one keyframe (controls.css `studio-pop`), what is picked changes
// tone on the tokens of tokens.css, and what a hand drags follows it with no
// easing at all. Components are asserted as source, like the audits.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const names = [
  'DraftsHub.svelte',
  'SettingsSheet.svelte',
  'ExportSheet.svelte',
  'PluginsSheet.svelte',
  'ColoursPanel.svelte',
  'ColourPicker.svelte',
  'PaletteBox.svelte',
  'ColorPanel.svelte',
  'BrushPanel.svelte',
  'BrushRail.svelte',
  'BrushSizes.svelte',
  'TransformMenu.svelte',
  'ScaleMenu.svelte',
];
const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await read(`./${name}`)] as const)));
const css = (name: string) => files[name].slice(files[name].lastIndexOf('<style'));
/** The first rule written for a selector, as text. */
const rule = (name: string, selector: string) =>
  css(name).match(new RegExp(`\\n  ${selector.replace(/[.:[\]>*()'=]/g, '\\$&')} \\{[^}]*\\}`))?.[0] ?? '';

const ARRIVAL = 'animation: studio-pop var(--dur-enter) var(--ease-out);';

describe('what arrives in a sheet or a panel arrives the shell’s way', () => {
  it('the keyframe is the shell’s own', async () => {
    expect(await read('./controls.css')).toContain('@keyframes studio-pop {');
  });

  it.each([
    // A sheet comes up from the edge it stands on.
    ['ExportSheet.svelte', '.sheet-dialog', '--pop-from: 8px;'],
    // A screen in the editor's box, a window, a list: no key to come from.
    ['SettingsSheet.svelte', '.sheet-dialog', '--pop-from: 0px;'],
    ['PluginsSheet.svelte', '.sheet-dialog', '--pop-from: 0px;'],
    ['DraftsHub.svelte', '.hub > *', '--pop-from: 0px;'],
    ['DraftsHub.svelte', '.hub > .size-menu', '--pop-from: 0px;'],
    ['ColourPicker.svelte', '.picker', '--pop-from: 0px;'],
    ['PaletteBox.svelte', '.preview', '--pop-from: 0px;'],
    ['BrushPanel.svelte', '.types', '--pop-from: 0px;'],
    // The export's end: the picture, the words, the refusal.
    ['ExportSheet.svelte', '.result', '--pop-from: 0px;'],
    ['ExportSheet.svelte', '.made', '--pop-from: 0px;'],
    ['ExportSheet.svelte', ".note[role='alert']", '--pop-from: 0px;'],
  ])('%s: %s', (name, selector, from) => {
    expect(rule(name, selector)).toContain(ARRIVAL);
    expect(rule(name, selector)).toContain(from);
  });

  it('the words of an «i» drop from their heading', () => {
    expect(rule('BrushPanel.svelte', '.note.open')).toContain(ARRIVAL);
    expect(rule('BrushPanel.svelte', '.note.open')).not.toContain('--pop-from');
  });

  it.each(['ExportSheet.svelte', 'SettingsSheet.svelte', 'PluginsSheet.svelte'])('%s: the scrim fades and never travels', (name) => {
    expect(rule(name, '.sheet-dialog::backdrop')).toContain('animation: scrim-in var(--dur-enter) var(--ease-out);');
    expect(css(name)).toMatch(/@keyframes scrim-in \{\s*from \{\s*opacity: 0;\s*\}\s*\}/);
  });
});

describe('the sheets move on the tokens', () => {
  it.each(names)('%s: no `transition: all`, no duration written out, nothing laid out', (name) => {
    const style = css(name);
    expect(style).not.toMatch(/transition:\s*all/);
    for (const line of style.match(/(transition|animation):[^;]*;/g) ?? []) {
      expect(line).not.toMatch(/\d(ms|s)\b/);
      expect(line).not.toMatch(/width|height|top|left|margin|filter/);
    }
  });

  it.each([
    ['SettingsSheet.svelte', '.tab'],
    ['SettingsSheet.svelte', '.preset-chip'],
    ['SettingsSheet.svelte', '.act'],
    ['ColoursPanel.svelte', '.tab'],
    ['ColourPicker.svelte', '.models button'],
    ['PaletteBox.svelte', '.foot-btn'],
    ['BrushPanel.svelte', '.type'],
    ['DraftsHub.svelte', '.draft-open'],
    ['DraftsHub.svelte', '.reel-dots span'],
  ])('%s: %s changes tone at the pace of a state', (name, selector) => {
    expect(rule(name, selector)).toMatch(/transition: background-color var\(--dur\) var\(--ease-out\)(, color var\(--dur\) var\(--ease-out\))?;/);
  });

  it('nothing rises under a cursor: a swatch is not a card', () => {
    expect(css('ColorPanel.svelte')).not.toContain('translateY');
    expect(css('DraftsHub.svelte')).not.toMatch(/:hover[^{]*\{[^}]*(transform|translate|scale)/);
  });

  it('a colour added to the palette fades in, and only fades', () => {
    expect(files['PaletteBox.svelte']).toContain("import { fade } from 'svelte/transition';");
    expect(files['PaletteBox.svelte']).toMatch(/class="cell"\s+in:fade=\{\{ duration: 150 \}\}\s+data-color=\{color\}/);
    for (const name of names) expect(files[name]).not.toMatch(/\b(fly|slide|scale|blur|draw|crossfade)\b[^\n]*from 'svelte\/transition'/);
  });
});

describe('what a hand drags follows the hand', () => {
  it.each([
    ['ColourPicker.svelte', '.dot'],
    ['ColourPicker.svelte', '.knob'],
    ['ColoursPanel.svelte', '.reticle'],
    ['ColoursPanel.svelte', '.slider input'],
    ['BrushRail.svelte', '.well input'],
    ['BrushPanel.svelte', ".brush-box input[type='range']"],
  ])('%s: %s has no transition and no animation', (name, selector) => {
    expect(rule(name, selector)).not.toBe('');
    expect(rule(name, selector)).not.toMatch(/transition|animation/);
  });
});
