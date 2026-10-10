import { describe, expect, it } from 'bun:test';
import { presetAbout, presets, presetUx } from './presets';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { createDocument } from '../model/operations';

// Первый вход в студию: над холстом лежит плашка с наборами. Нажал — панели
// переложились вживую, первый штрих её гасит. Спрашивают один раз: у кого
// настройки уже записаны, тот здесь был. Клей Svelte проверяется по исходнику,
// как в остальных тестах состояния (см. document-holder.test.ts).
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const editor = await Bun.file(UI + 'Editor.svelte').text();

describe('первый вход: набор выбирают над холстом', () => {
  it('спрашивают того, у кого настроек ещё нет', () => {
    expect(state).toMatch(/this\.presetAsk = saved === null;/);
  });

  it('закрытая плашка записывает настройки — в следующий раз её нет', () => {
    const close = state.match(/closePresetAsk\(\): void \{[\s\S]*?\n  }/)?.[0] ?? '';
    expect(close).toContain('this.presetAsk = false');
    expect(close).toContain('this.persistUiConfig()');
  });

  it('первый штрих её гасит, а под хабом и в режиме раскладки её нет', () => {
    expect(editor).toMatch(/if \(!isEmptyDocument\(editor\.doc\)\) editor\.closePresetAsk\(\);/);
    expect(editor).toMatch(/\{#if editor\.presetAsk && noteDue && !editor\.arranging\}/);
  });

  it('первый вход — сразу на лист 1280×720, мимо выбора листа', () => {
    expect(editor).toContain('let draftsOpen = $state(untrack(() => !editor.presetAsk && (startNew === true || editor.settings.showDraftsOnStart)));');
    // Документ меряет лист восьмыми долями пикселя: 1280×720 на экране.
    const doc = createDocument();
    expect([doc.width, doc.height]).toEqual([10240, 5760]);
  });

  it('слово площадки, которому место на сцене, стоит строкой в плашке — в любом наборе', () => {
    // В наборах без верхней панели (Multator, Toonio) подсказка «Кадр пустой?»
    // лежит на сцене, там же, где плашка: под плашкой она пропадала.
    const ask = editor.match(/<section class="preset-ask"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(ask).toContain('{#if !noteInPanel && !noteInTop}<div class="panel-note">{@render stageNote?.(!isEmptyDocument(editor.doc), frameCount(editor.doc), editor.playing)}</div>{/if}');
  });

  it('выбор — тот же, что в «Настройках»', () => {
    const ask = editor.match(/<section class="preset-ask"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(ask).toContain('{#each presets() as p (p.id)}');
    expect(ask).toContain('onclick={() => editor.applyPreset(p.id)}');
    expect(ask).toContain('aria-pressed={editor.preset === p.id}');
  });

  it('под именем набора — пара слов о нём, а у набора из плагина — число инструментов', () => {
    expect(presets().map((p) => p.id)).toEqual(['toonop', 'multator', 'toonio']);
    expect(presetAbout('toonop')).toBe('Сбалансированный');
    expect(presetAbout('multator')).toBe('Минимализм и классика');
    expect(presetAbout('toonio')).toBe('Гибкий и понятный');
    plugins.register({ id: 'first-visit.test', api: PLUGIN_API, presets: { own: { label: 'Свой', brush: 'toonop-brush', ux: { ...presetUx('multator') } } } });
    expect(presetAbout('own')).toBe('3 инструмента');
    const ask = editor.match(/<section class="preset-ask"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(ask).toContain('<span>{presetAbout(p.id)}</span>');
  });
});
