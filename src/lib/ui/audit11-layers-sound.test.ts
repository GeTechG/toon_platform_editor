import { describe, expect, it } from 'bun:test';
import { checkAudioFile, isAudioFile, readId3 } from '../audio/track';
import { t } from '../i18n';

const rows = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
const panel = await Bun.file(new URL('./AudioPanel.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

/** An ID3v2.4 tag of one TIT2 frame whose body (encoding byte included) is `data`. */
function title(data: number[], extended: number[] = []): ArrayBuffer {
  const frame = [...'TIT2'].map((c) => c.charCodeAt(0));
  const body = [...extended, ...frame, 0, 0, 0, data.length, 0, 0, ...data];
  return Uint8Array.from([0x49, 0x44, 0x33, 4, 0, extended.length ? 0x40 : 0, 0, 0, 0, body.length, ...body]).buffer;
}

/** «Тест» in UTF-16 big-endian. */
const BE = [0x04, 0x22, 0x04, 0x35, 0x04, 0x41, 0x04, 0x42];

describe('ID3 text in every encoding the tag allows', () => {
  it('encoding 2 is UTF-16 big-endian without a BOM', () => {
    expect(readId3(title([2, ...BE])).title).toBe('Тест');
  });

  it('encoding 1 with a big-endian BOM', () => {
    expect(readId3(title([1, 0xfe, 0xff, ...BE])).title).toBe('Тест');
  });

  it('a v2.4 extended header is stepped over, not read as frames', () => {
    // Six bytes: synchsafe size 6 (itself included), one flag byte count, no flags.
    expect(readId3(title([3, 0x41], [0, 0, 0, 6, 1, 0])).title).toBe('A');
  });
});

describe('an ogg the system calls video is still a sound', () => {
  it('Firefox and Windows type .ogg as video/ogg; the server takes it', () => {
    expect(isAudioFile({ type: 'video/ogg', name: 'песня.ogg' })).toBe(true);
    expect(checkAudioFile({ type: 'video/ogg', size: 10, name: 'песня.ogg' })).toBeNull();
  });

  it('an untyped file is judged by its name', () => {
    expect(isAudioFile({ type: '', name: 'song.opus' })).toBe(true);
    expect(isAudioFile({ type: '', name: 'photo.png' })).toBe(false);
    expect(isAudioFile({ type: 'video/mp4', name: 'clip.mp4' })).toBe(false);
  });

  it('the picker offers those files and the drop takes them', () => {
    expect(panel).toMatch(/accept="audio\/\*,\.ogg/);
    expect(editorUi).toContain('isAudioFile(file)');
  });
});

describe('the sound plate over the canvas has an edge in forced colors', () => {
  it('outlined like the menus and dialogs, since its tone is gone', () => {
    expect(panel).toMatch(/@media \(forced-colors: active\) \{\s*\.audio-plate \{\s*outline: 1px solid CanvasText;/);
  });
});

describe('layer rows', () => {
  it('a double click inside the open name field selects a word, it does not reset the text', () => {
    expect(rows).toContain('if (renaming?.layer === layerIndex)');
  });

  it('a truncated name can be read in full on hover', () => {
    expect(rows).toContain("title={`${editor.layerLabel(layerIndex)}\\n${t('layer.rename_hint')}`}");
  });

  it('a press on the handle that moved nothing announces nothing', () => {
    expect(rows).toContain('if (drag.currentLayer !== drag.fromLayer)');
  });

  it('only the main button drags: a right click on the handle is a context menu', () => {
    expect(rows).toContain('e.button !== 0');
  });

  it('the full stack says why «+ Слой» is off', () => {
    expect(rows).toContain("canAdd ? editor.keyHint(t('layer.add_title')) : t('layer.full', { max: MAX_LAYERS })");
    expect(t('layer.full', { max: 20 })).toBe('Больше 20 слоёв нельзя');
  });

  it('on a phone the tag keeps 5 px to each neighbour, the room its 24 px circle needs (2.5.8)', () => {
    expect(rows).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*\.tag \{\s*margin-inline: 1px;/);
  });

  it('the colour key quotes the layer name like its neighbours', () => {
    expect(t('layer.colour', { name: 'Фон' })).toBe('Цвет слоя «Фон»');
  });
});
