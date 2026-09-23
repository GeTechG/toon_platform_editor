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
