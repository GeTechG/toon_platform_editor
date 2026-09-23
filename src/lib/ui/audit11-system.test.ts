import { describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';
import { createErrorLog } from './error-log';

// Eleventh audit, the shared system: what the share page downloads, what
// outlives the studio when the site navigates away, and words that disagree
// with each other. Components are asserted as source, like shell-audit.test.ts.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const player = await read('../player/Player.svelte');
const track = await read('../audio/track.ts');
const editorUi = await read('./Editor.svelte');
const playControls = await read('./PlayControls.svelte');

describe('the share page does not download the studio’s vocabulary', () => {
  it('the player registers only its own words, not the whole catalogue', () => {
    expect(player).not.toMatch(/from '\.\.\/i18n'/);
    expect(player).toMatch(/import \{ play \} from '\.\.\/i18n\/ru\.json'/);
    expect(player).toContain("addResourceBundle(BASE_LOCALE, 'editor', { play }, true, false)");
  });

  it('the track maths the player borrows does not drag the catalogue in either', () => {
    expect(track).not.toMatch(/from '\.\.\/i18n'/);
    expect(track).toContain("translator('editor')");
  });
});

describe('the player', () => {
  it('a shorter document does not leave the old frame on screen', () => {
    expect(player).toMatch(/current >= frameCount\(view\)[^]{0,80}current = 0/);
  });

  it('lets go of the track it was fetching when it goes', () => {
    expect(player).toMatch(/element\.pause\(\);\s*element\.removeAttribute\('src'\);\s*element\.load\(\);/);
  });
});

describe('leaving the studio', () => {
  it('silences the track and frees what the editor minted', () => {
    const destroy = editorUi.match(/onDestroy\(\(\) => \{[^]*?\n  \}\);/)?.[0] ?? '';
    expect(destroy).toContain('editor.audio.clear()');
    expect(destroy).toContain('URL.revokeObjectURL');
  });

  it('a transport that goes mid-preview stops the preview, not only its clock', () => {
    expect(playControls).toMatch(/\$effect\(\(\) => \(\) => \{\s*if \(player\) \{?\s*stop\(\);/);
  });
});

describe('words that name the same thing agree', () => {
  it('the drafts are «Черновики» on the panel list too', () => {
    expect(ru.panel.item.drafts).toBe(ru.editor.drafts);
  });

  it('full screen is «Полный экран» in the manual too', () => {
    expect(ru.key.fullscreen).toBe(ru.editor.fullscreen);
  });
});

describe('reduced motion', () => {
  it('a switch changes its tone, its knob does not travel', async () => {
    const controls = await read('./controls.css');
    const reduced = controls.match(/@media \(prefers-reduced-motion: reduce\) \{[^]*?\n\}/)?.[0] ?? '';
    expect(reduced).toMatch(/input\[type='checkbox'\]\[role='switch'\] \{\s*transition: background-color 0\.15s, border-color 0\.15s;/);
  });
});

describe('the error log Alt+L hands over', () => {
  it('is not filled by the browser’s ResizeObserver notice, which every window resize raised', () => {
    const listeners = new Map<string, (e: Event) => void>();
    const log = createErrorLog();
    log.watch({ addEventListener: (type, fn) => listeners.set(type, fn) }, { error: () => {} });
    const fire = (message: string) => listeners.get('error')!({ message, error: null } as unknown as Event);
    fire('ResizeObserver loop completed with undelivered notifications.');
    fire('ResizeObserver loop limit exceeded');
    expect(log.lines).toEqual([]);
    fire('boom');
    expect(log.lines).toHaveLength(1);
  });
});
