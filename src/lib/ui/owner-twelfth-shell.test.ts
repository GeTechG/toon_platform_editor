import { afterEach, describe, expect, it } from 'bun:test';
import { keyOwner, type KeyTarget } from './key-owner';
import { RESERVED_KEYS } from '../plugins/builtins';
import { addStroke, createDocument, replaceCells } from '../model/operations';
import { importDrafts, listDrafts } from '../draft/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';
import ru from '../i18n/ru.json';

// The owner's answers after the twelfth audit, the shell's part. Components
// and the runes state are asserted as source; the cut, the import and the key
// rule run for real.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const editorUi = await read('./Editor.svelte');
const state = await read('./editor-state.svelte.ts');
const settingsSheet = await read('./SettingsSheet.svelte');
const audioPanel = await read('./AudioPanel.svelte');
const layerRows = await read('./LayerRows.svelte');

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

const fn = (name: string) =>
  editorUi.match(new RegExp(`\\n  (async )?function ${name}\\([^]*?\\n  }`))?.[0] ?? '';

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

// «Если нужны, то да»: C and V copy and paste the timeline selection, so
// Ctrl+X is the cut next to them — copy, then empty the cells, one undo step.
// Ctrl+arrows and Ctrl+X-as-swap stay gone: the bare keys already do both.
describe('Ctrl+X cuts the timeline selection', () => {
  const body: KeyTarget = { tagName: 'BODY', isContentEditable: false, getAttribute: () => null, matches: () => false };
  const chord = (key: string) =>
    keyOwner({ key, target: body, defaultPrevented: false, ctrlKey: true, metaKey: false, modalOpen: false, letterKeys: true });

  it('reaches the studio, while Ctrl+arrows stay the browser’s', () => {
    expect(chord('x')).toBe('editor');
    expect(chord('X')).toBe('editor');
    expect(chord('ArrowLeft')).toBe('control');
  });

  it('under Ctrl the X case cuts; bare X still swaps the colours', () => {
    expect(editorUi).toMatch(/case 'x':\s*case 'X':\s*if \(e\.ctrlKey \|\| e\.metaKey\) \{\s*editor\.cutSelection\(\);\s*\} else \{\s*editor\.swapColors\(\);/);
  });

  it('copies, then empties the cells in one filed edit', () => {
    const cut = member(state, 'cutSelection');
    expect(cut).toMatch(/this\.copySelection\(\);[^]*this\.snapshotCells\(target\)[^]*replaceCells\([^]*this\.pushEdit\(snapshots\)/);
    expect(cut).toContain('this.leaveTransform()');
  });

  it('an empty one-frame buffer per layer empties every selected cell', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 1], width: 8, color: '#000000' });
    const target = { frames: [0], layers: [0] };
    replaceCells(doc, target, target.layers.map(() => [{ strokes: [] }]));
    expect(doc.layers[0].frames[0].strokes).toEqual([]);
  });

  it('is in the key list and kept from plugins', () => {
    expect(editorUi).toContain("['Ctrl + X', t('key.cut')]");
    expect(t('key.cut')).toBe('Вырезать выделение ленты');
    expect(RESERVED_KEYS).toContain('Ctrl+X');
  });
});

// «Никогда» turns off the clock, not the last write: leaving the studio in any
// way writes what is on the sheet.
describe('leaving writes the draft whatever the autosave setting', () => {
  it('the flush no longer looks at the interval', () => {
    const flush = fn('flushOnLeave');
    expect(flush).toContain('saveNow()');
    expect(flush).not.toContain('autosaveMs');
  });

  it('beforeunload writes too, before it asks', () => {
    expect(editorUi).toMatch(/onbeforeunload=\{\(e\) => \{[^]*?flushOnLeave\(\);[^]*?e\.preventDefault\(\)/);
  });
});

// The reference's `HotEnter`: `a.altKey ? this.disableWarns = !this.disableWarns`
// (toonio.bundle.js:320), advertised in every question as «P.S. Press
// Alt+Enter to disable the warnings!» (:309, :322). The owner takes it away —
// a drawing must not go by accident — a deliberate step off parity.
describe('questions cannot be turned off', () => {
  it('Alt+Enter mutes nothing', () => {
    expect(editorUi).not.toMatch(/key === 'Enter'[^\n]*\n[^]*?editor\.warnings/);
    expect(editorUi).not.toContain('Alt + Enter');
    expect(RESERVED_KEYS).not.toContain('Alt+Enter');
  });

  it('no state, no banner, no text', () => {
    for (const source of [editorUi, state, settingsSheet, audioPanel, layerRows]) {
      expect(source).not.toMatch(/editor\.warnings|this\.warnings|warnings = \$state/);
    }
    expect(editorUi).not.toContain('warnings-off');
    expect(JSON.stringify(ru)).not.toMatch(/warnings_off|warnings_on|no_warnings/);
  });

  it('every question is asked', () => {
    expect(member(state, 'confirmed')).toMatch(/return this\.ask\(message\);/);
    expect(fn('askDelete')).toMatch(/return confirm\(message\);/);
  });

  it('a file over a drawing the browser will not keep says the drawing goes', () => {
    const open = fn('openFile');
    expect(open).toMatch(/storageBlocked \? 'editor\.file_open_lost_confirm' : 'editor\.file_open_confirm'/);
    expect(t('editor.file_open_lost_confirm', { name: 'a.toon' }))
      .toBe('Открыть «a.toon»? Браузер не хранит черновики: текущий рисунок пропадёт.');
  });
});

/** A `.toon` body the way the reference writes it: one layer, one frame, one line. */
function toonBytes(): Uint8Array {
  const words = [1, 1, 12, 999, 5, 0, 1, 1, 5, 0, 0, 0, 1, 0, 0, 1, 0, 2, 10, 20, 30, 40];
  return new Uint8Array(Int16Array.from(words).buffer);
}

const dataUrl = (bytes: Uint8Array, type: string) =>
  `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`;

// «Мы должны уметь импортировать их .toon, а сохранения всегда в нашем
// формате». A toonio.ru `.toonio` save keeps the `.toon` stream in `data` as a
// data URL, is keyed by `url` and dated by `created` (autosave_worker.js
// Export/Save). It is decoded into our document on the way in.
describe('a toonio.ru save file', () => {
  it('imports its drawings as our documents', async () => {
    setIndexedDB(fakeIndexedDB());
    const file = JSON.stringify({
      version: 5,
      saves: [{
        url: 'abc123',
        created: '2026-01-02T03:04:05.000Z',
        data: dataUrl(toonBytes(), 'application/octet-stream'),
        screenshot: dataUrl(new Uint8Array([1, 2, 3]), 'image/png'),
        audio: dataUrl(new Uint8Array([9, 8]), 'audio/mpeg'),
        audioName: 'Трек',
        audioAuthor: 'Кто-то',
        audioSync: false,
      }],
    });
    expect(await importDrafts(file)).toEqual({ loaded: 1, broken: 0 });
    const [draft] = await listDrafts();
    expect(draft.id).toBe('abc123');
    expect(draft.updated).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
    // Stored as ours: the current schema, not the `.toon` stream.
    const stored = draft.doc as ReturnType<typeof createDocument>;
    expect(stored.schema_version).toBe(createDocument().schema_version);
    expect(stored.layers[0].frames[0].strokes).toHaveLength(1);
    expect(draft.screenshot!.type).toBe('image/png');
    expect(new Uint8Array(await draft.audio!.blob.arrayBuffer())).toEqual(new Uint8Array([9, 8]));
    expect(draft.audio!.sync).toBe(false);
  });

  it('a save neither our format nor the .toon decoder reads is broken', async () => {
    setIndexedDB(fakeIndexedDB());
    const file = JSON.stringify({
      version: 5,
      saves: [
        { url: 'odd', data: dataUrl(new Uint8Array([1, 2, 3]), 'application/octet-stream') },
        { url: 'junk', data: 'not base64 at all!' },
      ],
    });
    expect(await importDrafts(file)).toEqual({ loaded: 0, broken: 2 });
  });
});
