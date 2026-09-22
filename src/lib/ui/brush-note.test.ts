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
