import { describe, expect, it } from 'bun:test';
import { pickerKeyAction } from './picker-model';
import { t } from '../i18n';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const canvas = await read('./CanvasView.svelte');
const brush = await read('./BrushPanel.svelte');
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');

describe('the colour window leaves Enter and Space to its keys', () => {
  it('a focused key presses itself instead of closing the window', () => {
    // Enter on «RGB» closed the window: the model could not be changed from
    // the keyboard, nor the original colour taken back.
    expect(pickerKeyAction('Enter', 'BUTTON')).toBeNull();
    expect(pickerKeyAction(' ', 'BUTTON')).toBeNull();
  });

  it('the surface and the bar still close on what is chosen, a field commits', () => {
    expect(pickerKeyAction('Enter', 'CANVAS')).toBe('close');
    expect(pickerKeyAction(' ', 'CANVAS')).toBe('close');
    expect(pickerKeyAction('Enter', 'INPUT')).toBe('commit');
    expect(pickerKeyAction(' ', 'INPUT')).toBeNull();
    expect(pickerKeyAction('a', 'CANVAS')).toBeNull();
  });

  it('the component asks the rule, not its own tag check', () => {
    expect(picker).toContain('pickerKeyAction(');
  });

  it('an emptied channel field is not read as zero', () => {
    // `Number('')` is 0: clearing R to type a new value painted the channel black.
    expect(picker).not.toContain('Number(e.currentTarget.value)');
  });

  it('names the wheel in the interface language', () => {
    expect(picker).not.toMatch(/\['wheel', 'Wheel'\]/);
    expect(t('picker.wheel')).toBe('Круг');
  });
});

describe('the brush fields never hand the brush a NaN', () => {
  it('an emptied number field is refused, not saved as `width: null`', () => {
    const snippet = brush.match(/\{#snippet slider[\s\S]*?\{\/snippet\}/)?.[0] ?? '';
    expect(snippet).toContain('Number.isFinite');
  });
});

describe('the saved palettes take a colour from the keyboard too', () => {
  it('a preview cell answers a click, not only a mouse press', () => {
    const grid = palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    // Enter on a button fires `click`, never `mousedown`: the preview was
    // mouse-only.
    expect(grid).toContain('onkeydown=');
  });

  it('counts the colours of a tile in Russian plurals', () => {
    expect(t('palette.tile', { name: 'А', count: 1 })).toBe('Палитра А, 1 цвет');
    expect(t('palette.tile', { name: 'А', count: 3 })).toBe('Палитра А, 3 цвета');
    expect(t('palette.tile', { name: 'А', count: 30 })).toBe('Палитра А, 30 цветов');
  });
});

describe('the canvas', () => {
  it('announces the hidden-layer hint from a live region that is already there', () => {
    // A `role="status"` mounted together with its text is not announced by
    // most screen readers: the region has to exist before the words change.
    const region = canvas.match(/<p class="hint"[^>]*>/)?.[0] ?? '';
    expect(region).toContain('role="status"');
    expect(canvas).not.toMatch(/\{#if hint\}\s*<p class="hint"/);
  });

  it('leaves Space to the preview: the canvas never pans on it', () => {
    // Space was both play/stop and a pan modifier: a held Space started the
    // preview and turned the next press on the sheet into a pan. The owner
    // keeps Space for playback only; the middle button, two fingers and the
    // hand still pan.
    expect(canvas).not.toContain('spaceHeld');
    expect(canvas).not.toMatch(/<svelte:window/);
  });

  it('sizes the hint in rem, so it follows the reader’s text size', () => {
    const style = canvas.match(/\.hint \{[\s\S]*?\}/)?.[0] ?? '';
    expect(style).not.toMatch(/font-size:\s*\d+px/);
  });
});

describe('the wheel over the canvas', () => {
  it('zooms by notches of travel, so a trackpad swipe or a sideways one does not fling the sheet', () => {
    expect(canvas).toContain('wheelNotch(wheelRest, e.deltaY, e.deltaMode)');
    expect(canvas).not.toContain('e.deltaY < 0 ? 1 : -1');
  });
});

describe('the transform handles under a finger', () => {
  it('a touch press reaches a handle from further off than the mouse does', () => {
    // ±10 px is a 20 px target: under 2.5.8's 24, and a fingertip is ~34.
    expect(canvas).toContain("e.pointerType === 'touch' ? hitZoom / TOUCH_REACH : hitZoom");
    expect(canvas).toContain('editor.transform.session, hitScale(e))');
    expect(canvas).toMatch(/const TOUCH_REACH = 1\.\d+;/);
  });
});

describe('the canvas windows follow the reader’s text size', () => {
  it('the zoom and transform windows size their words in rem, not px', async () => {
    for (const name of ['./ScaleMenu.svelte', './TransformMenu.svelte']) {
      const style = (await read(name)).split('<style>')[1] ?? '';
      expect(style).not.toMatch(/font-size:\s*\d+px/);
    }
  });
});

describe('a pinch', () => {
  it('zooms without the notches and restarts from the zoom the view took', () => {
    expect(canvas).toContain('stage, false);');
    expect(canvas).toContain('gesture = { ...next, zoom: editor.view.zoom };');
  });
});

describe('a release the canvas never heard', () => {
  it('ends the gesture when the mouse moves with no button held', () => {
    // The up landed elsewhere (a native dialog, the window lost focus): the
    // stroke stayed glued to a hovering cursor and refused the next press.
    expect(canvas).toContain("e.pointerType !== 'touch' && e.buttons === 0");
  });

  it('treats a lost capture as a cancel', () => {
    expect(canvas).toContain('onlostpointercapture={onPointerCancel}');
  });
});

describe('a tool’s own gesture', () => {
  it('moves and lets go on the tool it was started with, whatever key was pressed meanwhile', () => {
    // A hotkey mid-drag changed `editor.tool`: the move and the release went
    // to the new tool, or to none, and the old one was never let go.
    expect(canvas).toContain('pluginGrab = { pointerId: e.pointerId, spec }');
    expect(canvas).not.toContain('toolSpec(editor.tool)?.release?.(');
    expect(canvas).not.toContain('toolSpec(editor.tool)?.move?.(');
  });
});

describe('the hidden-layer hint', () => {
  it('says what to do about it, and stays long enough to be read', () => {
    // «Слой скрыт» named the trouble and vanished in 1.6 s; where the eye is
    // was left to guess.
    expect(t('canvas.hidden_layer')).toContain('глаз');
    expect(canvas).toContain('HINT_MS = 3000');
  });
});

describe('a second finger during a gesture of the canvas’s own', () => {
  it('drops the mega eraser, the tool’s drag and the handle along with the stroke', () => {
    // Only the pencil session was discarded: the first finger's release then
    // went to navigation, the eraser's preview stayed punched into the frame
    // and a tool's gesture was never let go.
    const start = canvas.match(/function startNavigation[^]*?\n  }\n/)?.[0] ?? '';
    expect(start).toContain('dropOwnGesture()');
    const drop = canvas.match(/function dropOwnGesture[^]*?\n  }\n/)?.[0] ?? '';
    for (const part of ['megaGesture = null', 'grab = null', 'editor.endPluginGesture()', 'gesturePointerId = -1']) {
      expect(drop).toContain(part);
    }
  });
});
