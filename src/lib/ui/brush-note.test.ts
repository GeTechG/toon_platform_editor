import { describe, expect, it } from 'bun:test';

// The help bubble in the brush box opened on hover and on keyboard focus only:
// moving the pointer onto the words closed them, Esc did not, and a finger —
// most of the audience — never saw them at all (WCAG 1.4.13).
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const style = panel.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';

describe('the brush help opens on a press and stays until dismissed', () => {
  it('hover and focus no longer drive it', () => {
    expect(style).not.toContain('.info:hover ~ .note');
    expect(style).not.toContain('.info:focus-visible ~ .note');
  });

  it('a press toggles it and Esc or leaving the key closes it', () => {
    const info = panel.match(/<button\s+class="info"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(info).toContain('onclick=');
    expect(info).toContain("e.key === 'Escape'");
    expect(info).toContain('onblur=');
    expect(style).toContain('.note.open');
  });
});

// Tenth audit. The «i» sits inside its heading, and the heading took its name
// from everything in it: a reader walking headings heard «Сглаживание
// Сглаживание: Больше — ровнее линия…». The heading is named by its title.
describe('the heading with a help key is named by its title alone', () => {
  it('the h2 carries its own name', () => {
    expect(panel).toMatch(/<h2 class="field" aria-label=\{title\}>/);
  });
});

// A brush may declare a range that does not start at 1: the track and the
// field started at 1 anyway, and the setter pushed the value back up.
describe('the thickness controls start where the brush range starts', () => {
  it('min is the range of the brush in hand', () => {
    expect(panel).toContain("slider(t('brush.sizes_group'), editor.brushRange.min,");
  });
});

// Tenth audit. The track holds positions, and it handed the unrounded one out
// as its value: an accessibility tree read aria-valuenow 258.976573734829.
// The position is rounded; the size itself is what aria-valuetext speaks.
describe('the thickness track exposes a whole position', () => {
  it('its value is rounded', () => {
    expect(panel).toContain('value={Math.round(positionOfSize(value, min, max))}');
    expect(panel).toContain("aria-valuetext={t('brush.size_value', { count: value })}");
  });
});
