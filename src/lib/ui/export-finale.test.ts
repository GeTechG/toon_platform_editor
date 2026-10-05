import { expect, it } from 'bun:test';
import ru from '../i18n/ru.json';

// Critique 2026-10-06: the session's success is «получил GIF», and it ended
// on «Файл готов» in 13 px grey — no picture of what came out, nothing on to
// the link a friend opens. The sheet shows the file it made, says how heavy
// it is and, where the host publishes, offers the way there.
const UI = new URL('./', import.meta.url).pathname;
const sheet = await Bun.file(UI + 'ExportSheet.svelte').text();
const studio = await Bun.file(UI + 'Editor.svelte').text();

it('a picture that came out is shown in the sheet', () => {
  expect(sheet).toMatch(/blob\.type\.startsWith\('image\/'\)[^]{0,120}URL\.createObjectURL\(blob\)/);
  expect(sheet).toMatch(/<img class="result" src=\{result\.url\} alt=\{t\('export\.result_alt'\)\}/);
});

it('the picture’s address is given back when the sheet is done with it', () => {
  const forget = sheet.slice(sheet.indexOf('function forget('), sheet.indexOf('}', sheet.indexOf('URL.revokeObjectURL(result.url)')));
  expect(forget).toContain('URL.revokeObjectURL(result.url)');
  expect(sheet).toMatch(/function openSheet\(\): void \{[^]*?forget\(\);/);
  expect(sheet).toMatch(/onclose=\{\(\) => \{[^]*?forget\(\);/);
});

it('the file’s weight is said with it', () => {
  expect(sheet).toContain('formatFileSize(result.bytes)');
});

it('where the host publishes, the sheet leads on to it', () => {
  expect(sheet).toMatch(/\{#if onPublish\}\s*<button class="key wide" onclick=\{\(\) => \{\s*close\(\);\s*onPublish\(\);/);
  expect(studio).toMatch(/<ExportSheet[^]*?onPublish=\{onPublish \? sendOut : undefined\}/);
  expect(ru.export.publish).toBe('Отправить мульт');
});
