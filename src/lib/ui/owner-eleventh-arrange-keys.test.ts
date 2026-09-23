import { describe, expect, it } from 'bun:test';
import { defaultPanels, hidePanelItem, movePanelItem, samePanels, showPanelItem } from './panels';
import { withoutLetterKeys } from './key-owner';

// Owner's calls after the eleventh audit: a hand-made panel arrangement is not
// thrown away without a question, and with «Горячие клавиши одной буквой» off
// no bare-letter hint is shown. The state and the components are asserted as
// source, like shell-audit.test.ts; the pure parts are tested for real.
const read = (name: string) => Bun.file(new URL(`./${name}`, import.meta.url)).text();
const state = await read('editor-state.svelte.ts');
const editorUi = await read('Editor.svelte');
const toolKey = await read('ToolKey.svelte');
const ru = JSON.parse(await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text());

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('an arrangement made by hand', () => {
  const panels = defaultPanels();

  it('is told apart from the preset\'s own, whatever order the shelf is in', () => {
    expect(samePanels(panels, defaultPanels())).toBe(true);
    expect(samePanels(panels, movePanelItem(panels, 'onion', 'left', 0))).toBe(false);
    const shelved = hidePanelItem(hidePanelItem(panels, 'onion'), 'fps');
    const reshelved = hidePanelItem(hidePanelItem(panels, 'fps'), 'onion');
    expect(samePanels(shelved, reshelved)).toBe(true);
    expect(samePanels(showPanelItem(shelved, 'onion'), shelved)).toBe(false);
  });

  it('«Сбросить» asks first, and only when the panels are not the preset\'s already', () => {
    const guard = method('mayReplacePanels');
    expect(guard).toContain('samePanels(this.panels, next)');
    expect(guard).toContain('samePanels(this.panels, presetPanels(this.preset))');
    // The question honours Alt+Enter like every other.
    expect(guard).toContain("this.confirmed(t('arrange.replace_confirm'");
    expect(method('resetPanels')).toMatch(/if \(!this\.mayReplacePanels\(next\)\)\s*\{?\s*return/);
  });

  it('a preset picked over it still comes, but the panels stay unless the answer is yes', () => {
    const apply = method('applyPreset');
    expect(apply).toMatch(/mayReplacePanels\(/);
    expect(apply).toMatch(/if \([^)]*keepPanels[^)]*\)|if \(!keepPanels\)/);
    expect(apply).toContain('this.preset = id');
  });

  it('the preset a plugin brings on load does not ask', () => {
    expect(method('refreshPlugins')).toContain('this.applyPreset(this.preset, false)');
  });

  it('the question speaks to «ты» and says the arrangement goes', () => {
    const copy: string = ru.arrange.replace_confirm;
    expect(copy).toContain('{{name}}');
    expect(copy).toMatch(/Твоя|твоя/);
    expect(copy).toMatch(/\?/);
  });
});

describe('with single-letter keys off', () => {
  it('a bare key in a title goes, with or without Shift', () => {
    expect(withoutLetterKeys('Карандаш (B)')).toBe('Карандаш');
    expect(withoutLetterKeys('Рука (D) — двигать холст')).toBe('Рука — двигать холст');
    expect(withoutLetterKeys('Дрожь (~) — дребезг штрихов кадра')).toBe('Дрожь — дребезг штрихов кадра');
    expect(withoutLetterKeys('Калька (K) включена')).toBe('Калька включена');
    expect(withoutLetterKeys('Отразить по вертикали (Shift+H)')).toBe('Отразить по вертикали');
    expect(withoutLetterKeys('Пипетка (P); правой кнопкой или Shift+Enter — в заливку'))
      .toBe('Пипетка; правой кнопкой или Shift+Enter — в заливку');
  });

  it('what works anyway stays, and is not swapped for a Ctrl hint', () => {
    expect(withoutLetterKeys('Шаг вперёд (Y или Ctrl+Shift+Z)')).toBe('Шаг вперёд (Ctrl+Shift+Z)');
    expect(withoutLetterKeys('Цвет контура (M — скрыть палитру)')).toBe('Цвет контура (скрыть палитру)');
    expect(withoutLetterKeys('Мега-ластик (Alt+E) — режет линии целиком')).toBe('Мега-ластик (Alt+E) — режет линии целиком');
    expect(withoutLetterKeys('Сохранить сейчас (Ctrl+S)')).toBe('Сохранить сейчас (Ctrl+S)');
    expect(withoutLetterKeys('Ширина панели (← / →)')).toBe('Ширина панели (← / →)');
    expect(withoutLetterKeys('Цвет слоя (нажми — следующий)')).toBe('Цвет слоя (нажми — следующий)');
    expect(withoutLetterKeys('Проект (.toonop)')).toBe('Проект (.toonop)');
    expect(withoutLetterKeys('Добавить кадр после текущего (A; Ctrl+нажатие — перед)'))
      .toBe('Добавить кадр после текущего (Ctrl+нажатие — перед)');
  });

  it('a key on its own, as the hover label and the manual spell it', () => {
    expect(withoutLetterKeys('Z')).toBe('');
    expect(withoutLetterKeys('H / Shift + H')).toBe('');
    expect(withoutLetterKeys('+ / −')).toBe('');
    expect(withoutLetterKeys('Y, Ctrl+Shift+Z')).toBe('Ctrl+Shift+Z');
    for (const kept of ['Del', 'Space', 'Ctrl + S', 'Alt + S', '← / →', 'Shift + ←→↑↓', 'Alt+S']) {
      expect(withoutLetterKeys(kept)).toBe(kept);
    }
  });

  it('the editor reads the setting through one helper', () => {
    expect(method('keyHint')).toMatch(/this\.settings\.letterKeys \? text : withoutLetterKeys\(text\)/);
  });

  it('a tool key drops its letter from the title and the hover label', () => {
    expect(toolKey).toContain('data-key={editor.keyHint(spec.key) || undefined}');
    expect(toolKey).toContain('title={editor.keyHint(spec.title)}');
  });

  it('the shell\'s letter keys drop their hover labels and titles', () => {
    for (const key of ['Z', 'Y', 'A', 'K', 'C', 'V', 'M']) {
      expect(editorUi).not.toContain(`data-key="${key}"`);
      expect(editorUi).toContain(`data-key={editor.keyHint('${key}') || undefined}`);
    }
    expect(editorUi).not.toMatch(/data-key=\{hasFeather \? undefined : 'F'\}/);
    for (const key of ['add_frame_title', 'undo_title', 'redo_title', 'fullscreen_title', 'copy_title', 'paste_title', 'merge_title']) {
      expect(editorUi).toContain(`editor.keyHint(t('editor.${key}'))`);
    }
  });

  it('the colour, palette and transform boxes drop theirs', async () => {
    const hinted = {
      'ColorPanel.svelte': ["t('color.quick_group')", "t('color.quick_title', { color })", "t('color.stroke_title')", "t('color.swap_title')"],
      'PaletteBox.svelte': ["t('color.swap_title')", "t('palette.pipette_title')"],
      'TransformMenu.svelte': ["t('transform.flip_h')", "t('transform.flip_v')", "t('transform.undo')", "t('transform.redo')"],
    };
    for (const [file, calls] of Object.entries(hinted)) {
      const ui = await read(file);
      for (const call of calls) {
        const bare = ui.split(call).length - 1;
        const wrapped = ui.split(`editor.keyHint(${call})`).length - 1;
        expect({ file, call, bare: bare - wrapped }).toEqual({ file, call, bare: 0 });
      }
    }
  });

  it('«Справка» lists no bare letter', () => {
    const table = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf('const SHORTCUTS') + 3000);
    expect(table).toMatch(/editor\.keyHint\(keys\)/);
  });
});

describe('«+ Слой» без буквенных клавиш', () => {
  it('подсказка кнопки идёт через keyHint', async () => {
    expect(await read('LayerRows.svelte')).toContain("editor.keyHint(t('layer.add_title'))");
  });
});
