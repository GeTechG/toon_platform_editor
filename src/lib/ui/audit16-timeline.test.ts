import { describe, expect, it } from 'bun:test';
import { playableFormats } from '../audio/track';

// Sixteenth audit: the timeline, the layers, the sound and the transport.
// Runes components are checked by their source, as in audit15-timeline.test.ts;
// the pure helpers by what they do.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const play = await Bun.file(UI + 'PlayControls.svelte').text();
const panel = await Bun.file(UI + 'AudioPanel.svelte').text();
const editorView = await Bun.file(UI + 'Editor.svelte').text();
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();

/** Тело функции из исходника компонента, до закрывающей скобки. */
function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  }`))?.[0] ?? '';
}

/** Разметка кнопки, открывающаяся на `marker`, до конца её открывающего тега. */
function tagAround(source: string, marker: string): string {
  const at = source.indexOf(marker);
  const open = source.lastIndexOf('<', at);
  return source.slice(open, source.indexOf('>', at) + 1);
}

describe('шестнадцатый аудит: протяжка кончается с кнопкой', () => {
  it('ручка слоя без зажатой кнопки не переставляет слои наведением', () => {
    // Отпустили за окном (Alt+Tab посреди переноса): pointerup не пришёл, и
    // каждое движение мыши потом двигало слой по списку.
    const body = fn(rows, 'onHandleMove');
    expect(body).toMatch(/e\.buttons & 1/);
    expect(body.indexOf('e.buttons')).toBeLessThan(body.indexOf('updateTarget'));
  });

  it('разделитель колонки без зажатой кнопки не тянет ширину наведением', () => {
    const body = fn(timeline, 'onColMove');
    expect(body).toMatch(/e\.buttons & 1/);
    expect(body.indexOf('e.buttons')).toBeLessThan(body.indexOf('setCol'));
  });
});

describe('шестнадцатый аудит: меню кадра под пером', () => {
  it('удержание пером открывает меню, как пальцем: iPad не шлёт contextmenu для Pencil', () => {
    const body = fn(timeline, 'onCellDown');
    expect(body).toMatch(/pointerType === 'pen'[^\n]*\n?[^\n]*startLongPress/);
    // Перо по-прежнему тянет выделение: удержание не выходит из функции.
    const pen = body.indexOf("'pen'");
    expect(pen).toBeGreaterThan(-1);
    expect(pen).toBeLessThan(body.indexOf('dragging = true'));
  });
});

describe('шестнадцатый аудит: клавиша, выключенная своим нажатием, держит фокус', () => {
  it('⏮ и ⏭ на краю ленты — aria-disabled, а не disabled', () => {
    // Enter на ⏮ уводил на кадр 1, кнопка гасла под фокусом, и фокус падал на body.
    for (const marker of ["t('editor.first_frame')", "t('editor.last_frame')"]) {
      const at = editorView.indexOf(marker);
      const tag = editorView.slice(editorView.lastIndexOf('<button', at), at);
      expect(tag).toMatch(/aria-disabled=/);
      expect(tag).not.toMatch(/disabled=\{editor\.playing \|\| editor\.activeFrame/);
    }
  });

  it('«Удалить кадр» на последнем кадре Toonio — aria-disabled', () => {
    const at = editorView.indexOf("t('editor.delete_frame_title')");
    const tag = editorView.slice(editorView.lastIndexOf('<button', at), at);
    expect(tag).toMatch(/aria-disabled=\{!editor\.canRemoveFrame/);
    expect(tag).not.toMatch(/disabled=\{editor\.playing \|\| !editor\.canRemoveFrame\}/);
  });

  it('«+ Слой» на двадцатом слое — aria-disabled', () => {
    const tag = tagAround(rows, 'class="add-layer"');
    expect(tag).not.toMatch(/\sdisabled=\{!canAdd\}/);
    expect(tag).toMatch(/aria-disabled=\{!canAdd \|\| editor\.playing/);
  });

  it('«Проиграть», которому нечего играть, — aria-disabled', () => {
    const tag = tagAround(play, 'class="key play"');
    expect(tag).not.toMatch(/\sdisabled=\{!canPlay\}/);
    expect(tag).toMatch(/aria-disabled=\{!canPlay/);
  });

  it('ползунок fps не гаснет под фокусом на Space, а скорость в просмотре не меняется', () => {
    const at = editorView.indexOf("{:else if id === 'fps'}");
    const fps = editorView.slice(at, editorView.indexOf('</label>', at));
    expect(fps).not.toMatch(/\sdisabled=\{editor\.playing\}/);
    expect(fps.match(/aria-disabled=\{editor\.playing/g)?.length).toBe(2);
    expect(state).toMatch(/setFps\(value: number\): void \{[^}]*if \(this\.playing\)/);
  });

  it('погашенная так клавиша и выглядит выключенной', () => {
    expect(editorView).toMatch(/\.editor :global\(\.key\[aria-disabled='true'\]\) \{[^}]*opacity: 0\.4;/);
    expect(editorView).toMatch(/\.fps-inline input\[aria-disabled='true'\] \{[^}]*opacity/);
  });
});

describe('шестнадцатый аудит: имя слоя без правки', () => {
  it('Enter без правки не превращает номер слоя в записанное имя', () => {
    // «Слой 2» без своего имени — это позиция; F2 и Enter записывали его
    // именем, и перенос слоя больше не перенумеровывал ряд.
    const body = fn(rows, 'commitRename');
    expect(body).toMatch(/renaming\.text !== editor\.layerLabel\(renaming\.layer\)/);
  });
});

describe('шестнадцатый аудит: отказ звука в просмотре слышен', () => {
  it('ошибка звука во время просмотра — в строке подсказки холста, а не только в закрытой плашке', () => {
    // «Браузер не дал включить звук» писался в плашку «Звук», которая
    // обычно закрыта: просмотр шёл молча без объяснения.
    expect(play).toMatch(/const error = editor\.audio\.error;/);
    expect(play).toMatch(/editor\.canvasHint = \{ text: error \}/);
    // Только новая ошибка: старая не всплывает на каждом нажатии «играть».
    expect(play).toMatch(/untrack\(\(\) => editor\.playing\)/);
  });
});

describe('шестнадцатый аудит: подсказка о форматах звука', () => {
  it('называет только то, что этот браузер играет', () => {
    // Safari 16 не играет ogg, а плашка обещала «mp3, ogg или wav».
    const safari = (type: string) => (type === 'audio/ogg' ? '' : 'maybe');
    expect(playableFormats(safari)).toEqual(['mp3', 'wav']);
    expect(playableFormats(() => 'probably')).toEqual(['mp3', 'ogg', 'wav']);
    expect(playableFormats(() => '')).toEqual([]);
  });

  it('плашка собирает список из этих форматов', async () => {
    const audioState = await Bun.file(new URL('../audio/state.svelte.ts', import.meta.url)).text();
    expect(panel).toMatch(/const formats = playableWords\(\)/);
    expect(audioState).toMatch(/playableFormats\(canPlayType\)/);
    expect(audioState).toMatch(/Intl\.ListFormat/);
  });
});

describe('шестнадцатый аудит: отказ чтения звука называет форматы этого браузера', () => {
  it('Safari 16 без ogg слышит «mp3 или wav», а не «mp3, ogg или wav»', async () => {
    const { playableWords } = await import('../audio/state.svelte');
    const noOgg = (type: string) => (type.includes('ogg') ? '' : 'maybe');
    expect(playableWords(noOgg)).toBe('mp3 или wav');
    expect(playableWords(() => '')).toBe('mp3, ogg или wav');
  });

  it('подсказка об ошибке чтения и плашка берут один список', async () => {
    const audioState = await Bun.file(new URL('../audio/state.svelte.ts', import.meta.url)).text();
    expect(audioState).toMatch(/t\('audio\.undecodable', \{ formats: playableWords\(/);
    expect(panel).toMatch(/playableWords\(/);
  });
});
