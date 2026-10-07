import { describe, expect, it } from 'bun:test';

// Owner answers after the sixteenth audit, tools: a tool whose key leaves the
// panels does not stay in the hand, and the pipette promises the screen
// eyedropper only where there is one. The store and the key are runes
// components, so they are asserted as source.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const toolKey = await Bun.file(new URL('./ToolKey.svelte', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).json();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('the tool in hand goes when its key leaves the panels', () => {
  it('the pencil comes back, as when the tool\'s plugin is removed', () => {
    // Multator's preset left the mega eraser in the hand with no key on the
    // rail to show it; so did a key put on the shelf.
    const keep = method('keepToolOnPanel');
    expect(keep).toContain('this.availableTools.includes(this.tool)');
    expect(keep).toContain("this.selectTool('pencil', 'outline', [...this.availableTools, 'pencil'])");
  });

  it('every change of the arrangement asks', () => {
    for (const name of ['applyPreset', 'movePanelItem', 'setPanels', 'togglePanelItem']) {
      expect(method(name)).toContain('this.keepToolOnPanel()');
    }
  });
});

describe('the pipette names the screen eyedropper only where it opens', () => {
  it('the key shows the short title without EyeDropper or with the setting off', () => {
    expect(ru.tool.pipette.title).not.toContain('ещё раз');
    expect(ru.tool.pipette.title_screen).toContain('Ещё одно нажатие берёт цвет с экрана');
    // 2026-10-08 critique: «— ещё раз: настройки кисти» had no verb and put a second dash after «Мега-ластик (Alt+E) — режет линии целиком».
    expect(ru.tool.again_brush).toBe('{{title}}. Ещё одно нажатие открывает настройки кисти');
    expect(toolKey).toContain("'EyeDropper' in globalThis");
    expect(toolKey).toContain('editor.settings.chromePicker');
    expect(toolKey).toContain("t('tool.pipette.title_screen')");
  });
});
