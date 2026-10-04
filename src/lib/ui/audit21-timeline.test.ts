import { describe, expect, it } from 'bun:test';

// Двадцать первый аудит: лента, слои, звук и транспорт.
// Компоненты на рунах проверяются по исходнику, как в audit20-timeline.test.ts;
// чистые функции — по тому, что они делают.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const rows = await Bun.file(UI + 'LayerRows.svelte').text();

describe('двадцать первый аудит: меню кадра держит клавиатуру, пока открыто', () => {
  // Правый клик по ячейке вне выделения: нажатие ставит фокус на ячейку, меню
  // выбирает её (активная ячейка сменилась) — и эффект «фокус едет за активной
  // ячейкой» после тика забирал фокус у первого пункта меню обратно в ленту.
  // Стрелки ходили по слоям под открытым меню, Esc его не закрывал, а пункт
  // действовал уже на другую ячейку.
  it('фокус не уходит за активной ячейкой, когда меню открыто', () => {
    const effect = timeline.match(/let lastCell: HTMLElement \| null = null;\s+\$effect\(\(\) => \{[^]*?\n  \}\);/)?.[0] ?? '';
    expect(effect).toContain('editor.displayedFrame');
    // Проверка — в отложенной части: меню ставится после выбора ячейки, и
    // прочитанное в самом эффекте стало бы его зависимостью.
    expect(effect).toMatch(/tick\(\)\.then\(\(\) => \{\s+if \(!menu\) strip\?\.querySelector<HTMLElement>\('\.cell\.active'\)\?\.focus\(\);/);
  });
});

describe('двадцать первый аудит: имя слоя открывается для правки', () => {
  // Документ лежит в `$state.raw`, а «что переименовываем» — в глубоком
  // `$state`: слой, положенный туда, оборачивался в прокси и никогда не был
  // равен слою документа. Поле не открывалось ни двойным кликом, ни F2, ни
  // удержанием — а Delete, нажатый «в поле», удалял слой.
  it('слой в «renaming» хранится как есть, без прокси', () => {
    expect(rows).toMatch(/let renaming = \$state\.raw<\{ layer: number; ref: Layer; text: string \} \| null>\(null\);/);
  });

  it('набранное кладётся новым объектом: у сырого состояния поля не реактивны', () => {
    expect(rows).not.toContain('bind:value={renaming.text}');
    expect(rows).toMatch(/value=\{renaming\.text\}\s+oninput=\{\(e\) => \(renaming = \{ \.\.\.renaming!, text: e\.currentTarget\.value \}\)\}/);
  });
});

describe('двадцать первый аудит: отмена переноса слоя не роняет клавиатуру', () => {
  // Alt+↑ в списке слоёв, затем Ctrl+Z: Svelte переставляет строку, фокус
  // уходил на <body> — следующий Tab начинал со страницы заново. Сам перенос
  // фокус возвращает (`focusCell`), отмена и повтор — нет.
  it('до перестановки запоминается, был ли фокус в списке', () => {
    expect(rows).toMatch(/\$effect\.pre\(\(\) => \{\s+void editor\.layerMoved;\s+hadFocus = !!listEl\?\.contains\(document\.activeElement\);/);
  });

  it('после объявления фокус ставится на перенесённый слой', () => {
    const effect = rows.match(/let heard:[^]*?\n  \}\);/)?.[0] ?? '';
    expect(effect).toMatch(/announce\(moved\.layer\);\s+if \(hadFocus\) focusCell\(moved\.layer\);/);
  });
});
