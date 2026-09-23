/**
 * Hands the browser a file to save; nothing here touches the network.
 *
 * The URL outlives the click: revoked at once, Firefox and Safari may find
 * nothing behind it when the download actually starts — and the editor had
 * six copies of this, five of which revoked at once.
 */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The bits of File System Access a streamed export needs; absent in Firefox and Safari. */
interface SaveFilePicker {
  showSaveFilePicker(options: {
    suggestedName: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle & { remove?: () => Promise<void> }>;
}

/**
 * Asks where to put a file before it is built, so it can be written straight
 * to disk. `null`: no File System Access here, or the picker refused — the
 * caller builds in memory and hands the file over as ever. Throws the
 * picker's `AbortError` when the person closed it: nothing is to be built.
 * Must run inside the click, before any other await.
 */
export async function pickSaveFile(
  name: string,
  mimeType: string,
): Promise<(FileSystemFileHandle & { remove?: () => Promise<void> }) | null> {
  const picker = globalThis as unknown as Partial<SaveFilePicker>;
  if (typeof picker.showSaveFilePicker !== 'function') {
    return null;
  }
  const extension = name.slice(name.lastIndexOf('.'));
  try {
    return await picker.showSaveFilePicker({ suggestedName: name, types: [{ accept: { [mimeType]: [extension] } }] });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw err;
    }
    console.warn('save picker unavailable:', err);
    return null;
  }
}
