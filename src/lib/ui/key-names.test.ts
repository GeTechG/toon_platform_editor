import { describe, expect, it } from 'bun:test';

const read = (name: string) => Bun.file(new URL(name, import.meta.url).pathname).text();
const shell = await read('./Editor.svelte');
const page = await read('../../../../apps/web/src/routes/editor/+page.svelte');
const ru = JSON.parse(await read('../i18n/ru.json'));

// Critique 2026-10-07, owner's pick: a key is an icon, and its name lived in
// `title` alone. Under a cursor the icon was swapped for the shortcut's letter
// — at the very moment it was being looked at; under a finger nothing named
// it at all.
describe('a key says its name', () => {
  it('the cursor no longer swaps the icon for a letter', () => {
    expect(shell).not.toContain('content: attr(data-key);');
  });

  it('a plate by the key carries what its title says, at once', () => {
    expect(shell).toContain('onpointerover={nameKey}');
    expect(shell).toContain('onfocusin={nameKey}');
    const name = shell.slice(shell.indexOf('function nameKey('), shell.indexOf('function unnameKey('));
    // A finger has no hover: the plate would stick after the tap.
    expect(name).toContain("e.pointerType !== 'mouse'");
    expect(name).toContain("key?.getAttribute('title') ?? key?.getAttribute('aria-label')");
    // The browser's own tooltip would say the same a second later.
    expect(name).toContain("key.removeAttribute('title')");
    expect(shell).toMatch(/<p class="key-name" popover="manual" aria-hidden="true"/);
  });

  it('on a phone the first visit names the row of keys, until the first stroke', () => {
    // …or until a key of the row is pressed: «⋯» and the colours open where
    // the names hang, and lay half over them.
    expect(shell).toContain('class:named={named && !rowPressed}');
    expect(shell).toContain('onpointerdowncapture={() => (rowPressed = true)}');
    const rule = shell.slice(shell.indexOf('.studio.compact.named .top :global(.key)::after {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('content: attr(aria-label);');
    expect(shell).toContain('.studio.compact.named .top :global(.key[data-name])::after {');
    // Out of the flow: the bar keeps its height, the sheet does not jump under
    // the stroke that puts the names away.
    expect(rule.slice(0, rule.indexOf('}'))).toContain('position: absolute;');
    expect(page).toContain('named={showHint}');
  });

  it('the long names have a short one for the row', () => {
    expect(ru.editor.publish_short.length).toBeLessThanOrEqual(9);
    expect(ru.editor.tools_short.length).toBeLessThanOrEqual(8);
    expect(shell).toContain("data-name={t('editor.publish_short')}");
    expect(shell).toContain("'data-name': t('editor.tools_short')");
  });
});
