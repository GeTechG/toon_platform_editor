import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import ru from '../i18n/ru.json';
import { whenYes } from './ask';

// Critique 2026-10-06: the questions about losing work — «Удалить «Слой 2»?»,
// «Открыть файл? Текущий рисунок будет заменён» — and every failure went to
// the browser's own confirm() and alert(): its chrome, its «OK», the page's
// address on top. The studio asks in its own sheet, which answers later, not
// on the same line — so the state runs the rest when the answer comes.
describe('an answer that comes later', () => {
  it('a yes on the spot runs the rest on the spot, a no never does', () => {
    let ran = 0;
    whenYes(true, () => ran++);
    whenYes(false, () => ran++);
    expect(ran).toBe(1);
  });

  it('a yes from the sheet runs the rest once it is given', async () => {
    let ran = 0;
    let answer!: (yes: boolean) => void;
    whenYes(new Promise<boolean>((resolve) => (answer = resolve)), () => ran++);
    expect(ran).toBe(0);
    answer(true);
    await Promise.resolve();
    expect(ran).toBe(1);
  });

  it('a no from the sheet runs nothing', async () => {
    let ran = 0;
    whenYes(Promise.resolve(false), () => ran++);
    await Promise.resolve();
    expect(ran).toBe(0);
  });
});

const UI = new URL('./', import.meta.url).pathname;
const read = (name: string) => Bun.file(UI + name).text();

describe('the studio asks in its own sheet', () => {
  it('no component calls the browser for a question, a note or a name', async () => {
    const calls: string[] = [];
    for (const name of readdirSync(UI).filter((file) => file.endsWith('.svelte'))) {
      for (const [i, line] of (await read(name)).split('\n').entries()) {
        // The one way left to the browser: arrangements answer on the same
        // line (`askNow`), and those are a desktop's, made with a mouse.
        const code = !/^\s*(\/\/|\*|\/\*|<!--)/.test(line);
        if (code && /(?<![.\w])(confirm|alert|prompt)\(/.test(line) && !line.includes('editor.askNow =')) {
          calls.push(`${name}:${i + 1}`);
        }
      }
    }
    expect(calls).toEqual([]);
  });

  it('the sheet is a modal dialog with a yes and a way back', async () => {
    const studio = await read('Editor.svelte');
    const sheet = studio.slice(studio.indexOf('{#if question}'), studio.indexOf('{/if}', studio.indexOf('bind:this={questionDialog}')));
    expect(sheet).toContain('onclose={() => answer(false)}');
    expect(sheet).toMatch(/aria-labelledby="ask-text"/);
    expect(studio).toMatch(/questionDialog\?\.showModal\(\)/);
  });

  it('a deletion is answered with «Удалить», not «OK»', () => {
    expect(ru.ask).toEqual({ yes: 'Да', delete: 'Удалить', no: 'Отмена', ok: 'Понятно', save: 'Сохранить' });
  });
});
