import { afterEach, describe, expect, it, mock } from 'bun:test';

import { listInstalled, putInstalled, removeInstalled, type InstalledPlugin } from './store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

const record = (id: string, version = '1.0.0'): InstalledPlugin => ({
  id,
  version,
  name: id,
  description: '',
  icon: '<path d="M4 4h16" />',
  code: 'export default {}',
  source: 'catalog',
  installed: 1,
});

/** The store opens at version 1: it has no past to carry. */
const fake = () => fakeIndexedDB(new Map(), 1);

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('installed plugins', () => {
  it('hands back what was put in, with its code', async () => {
    setIndexedDB(fake());
    await putInstalled(record('halftone'));
    const installed = await listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].id).toBe('halftone');
    expect(installed[0].code).toBe('export default {}');
  });

  it('replaces the record of a plugin instead of piling versions up', async () => {
    setIndexedDB(fake());
    await putInstalled(record('halftone', '1.0.0'));
    await putInstalled(record('halftone', '1.1.0'));
    const installed = await listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].version).toBe('1.1.0');
  });

  it('removes one plugin and leaves the rest', async () => {
    setIndexedDB(fake());
    await putInstalled(record('a'));
    await putInstalled(record('b'));
    await removeInstalled('a');
    expect((await listInstalled()).map((p) => p.id)).toEqual(['b']);
  });

  it('is empty when nothing is installed', async () => {
    setIndexedDB(fake());
    expect(await listInstalled()).toEqual([]);
  });

  it('degrades quietly without IndexedDB', async () => {
    // Private mode, blocked storage: installing is then a no-op that lives
    // until the page is left — never an exception into the editor.
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      await expect(putInstalled(record('a'))).resolves.toBe(false);
      await expect(removeInstalled('a')).resolves.toBe(false);
      expect(await listInstalled()).toEqual([]);
    } finally {
      console.warn = original;
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
