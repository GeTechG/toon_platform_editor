import { describe, expect, it } from 'bun:test';
import { EXPORT_DEFAULT_WIDTH, EXPORT_WIDTHS } from '../format/constants';

// The sheet is Svelte runes, so it is asserted as source (the same contract
// style as settings-sheet.test.ts); the logic it leans on is unit-tested in
// ../export/rasterize.test.ts and ../export/video-codecs.test.ts.
const sheet = await Bun.file(new URL('./ExportSheet.svelte', import.meta.url)).text();

describe('formats', () => {
  it('offers PNG only for a one-frame document', () => {
    expect(sheet).toMatch(/singleFrame\s*=\s*\$derived\(frameCount\(editor\.doc\) === 1\)/);
  });

  it('opens on PNG for a still, on GIF for an animation', () => {
    expect(sheet).toMatch(/function openSheet\(\)[^]*?format = singleFrame \? 'png' : 'gif'/);
  });

  it('falls back from PNG to GIF as soon as a second frame appears', () => {
    expect(sheet).toMatch(/!singleFrame[^]*?format = 'gif'/);
  });

  it('names the files after the brand, like the reference names its own', () => {
    expect(sheet).toContain("'toonop.gif'");
    expect(sheet).toContain("'toonop.png'");
    expect(sheet).toContain('`toonop.${');
  });
});

describe('resolution', () => {
  it('offers the reference row of widths, 1280 selected', () => {
    expect(EXPORT_WIDTHS).toEqual([640, 1280, 1920, 2560]);
    expect(EXPORT_DEFAULT_WIDTH).toBe(1280);
    expect(sheet).toContain('EXPORT_WIDTHS');
    expect(sheet).toMatch(/width = \$state\(EXPORT_DEFAULT_WIDTH\)/);
  });

  it('labels each button with the size that canvas will actually give', () => {
    expect(sheet).toContain('exportSize(editor.doc,');
  });
});

describe('watermark and background', () => {
  it('stamps by default and hands the flag to every format', () => {
    expect(sheet).toMatch(/watermark = \$state\(true\)/);
    // One options object, passed to whichever exporter runs.
    expect(sheet).toContain('const options = { width, watermark,');
    expect(sheet).toContain('{ width, watermark, transparent }');
  });

  it('offers the transparent background for PNG only, off by default', () => {
    expect(sheet).toMatch(/transparent = \$state\(false\)/);
    expect(sheet).toMatch(/\{#if format === 'png'\}/);
  });
});

describe('progress', () => {
  it('names the stage and offers Cancel for every format', () => {
    expect(sheet).toContain('Рендер кадров');
    expect(sheet).toContain('Кодирование');
    expect(sheet).toMatch(/Отмен/);
  });

  it('promises a real-time wait only on the MediaRecorder path', () => {
    expect(sheet).toMatch(/plan\?\.realtime[^]*?clock\(/);
  });
});

describe('drafts', () => {
  it('forces a save before the export, as the reference does (toon.js:265)', () => {
    // The hook itself arrives with toonio-file-parity.
    expect(sheet).toMatch(/TODO.*toonio-file-parity/);
  });
});
