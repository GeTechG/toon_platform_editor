import { describe, expect, test } from 'bun:test';
import { defaultPanels, movePanelItem } from './panels';
import { boxRow, canvasFloor, pickStep, TABLET_MIN_W, yieldToCanvas } from './small-screen';

// Двадцать первый аудит, окна и раскладка. Клей Svelte проверяется по
// исходнику (как в audit11–20-windows), чистые части — вживую.
const shell = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();

// Палитра, побывавшая отдельной третьей строкой, оставляла свои 239px в
// `rowBoxes[2]`. Кисть, брошенная потом новой третьей строкой, на кадр
// считалась дважды — в старой строке и под чужой меркой, — пол панели
// вырастал, и студия на экране 1700×1300 уходила в раскладку телефона прямо
// посреди режима раскладки. Строк там не рисуется, мерки не обновляются —
// навсегда, до перезагрузки.
describe('мерка ушедшей строки не переживает строку', () => {
  test('оболочка обрезает мерки до числа строк', () => {
    const at = shell.indexOf('let rowBoxes = $state');
    const cut = shell.slice(at, shell.indexOf('const KEY_ROW', at));
    expect(cut).toMatch(/\$effect\(\(\) => \{\s*const rows = editor\.panels\.rows\.length;/);
    expect(cut).toMatch(/rowBoxes\.length\) > rows\) rowBoxes\.length = rows;/);
  });
});

// Свёрнутая нижняя панель с 20-го круга ставит брошенное в конец (владелец,
// после 19-го аудита: «как у свёрнутой боковой колонки»). Сама свёрнутая
// колонка ставила его первым: предметов в ней не нарисовано, целиться не
// между чем, и индекс выходил 0 — «Звук» вставал над карандашом.
describe('бросок на свёрнутую колонку ставит предмет в конец', () => {
  test('обе колонки помечают себя свёрнутыми', () => {
    for (const id of ['left', 'right']) {
      const at = shell.indexOf(`data-slot="${id}"`);
      expect(at).toBeGreaterThan(0);
      expect(shell.slice(at, at + 120)).toContain(`data-folded={folded('${id}') ? '' : undefined}`);
    }
  });

  test('раскладка спрашивает пометку раньше, чем меряет соседей', () => {
    const aim = arranger.slice(arranger.indexOf('function aim('), arranger.indexOf('async function settle('));
    const folded = aim.indexOf('panelEl.dataset.folded !== undefined');
    expect(folded).toBeGreaterThan(0);
    expect(folded).toBeLessThan(aim.indexOf('dropPlacement('));
    expect(aim.slice(folded, folded + 160)).toContain('index: Number.MAX_SAFE_INTEGER');
  });

  test('индекс «дальше некуда» — это конец колонки', () => {
    const before = defaultPanels();
    const after = movePanelItem(before, 'audio', 'left', Number.MAX_SAFE_INTEGER);
    expect(after.left.at(-1)).toBe('audio');
    expect(after.left.slice(0, -1)).toEqual(before.left);
  });
});

// Ступень раскладки считала то, что растянула рука: разделитель нижней панели,
// утянутый вверх на 1400×900, ширина колонки 480 на 1024×768, палитра в строке
// на 1366×650 — и студия уходила в раскладку телефона, где нет ни разделителя,
// ни режима раскладки, чтобы вернуть. Владелец, 21-й аудит: растянутое
// уступает холсту, компакт — только там, где не помещается базовый пол.
describe('растянутое уступает холсту', () => {
  test('пол холста — тот же, по которому выбирается ступень', () => {
    expect(canvasFloor({ w: 1400, h: 900 })).toEqual({ w: 360, h: 342 });
    expect(canvasFloor({ w: 1366, h: 650 })).toEqual({ w: 360, h: 320 });
    expect(canvasFloor({ w: 700, h: 500 }).w).toBeCloseTo(315);
    // Ровно пол — ещё полная раскладка, на пиксель меньше — уже нет.
    const view = { w: 1400, h: 900 };
    const roomy = { w: 900, h: 900 };
    expect(pickStep('full', { full: { w: 360, h: 342 }, tablet: roomy }, view)).toBe('full');
    expect(pickStep('full', { full: { w: 360, h: 341 }, tablet: roomy }, view)).not.toBe('full');
    expect(pickStep('full', { full: { w: 359, h: 342 }, tablet: roomy }, view)).not.toBe('full');
  });

  test('размер рисуется не больше, чем оставляет холст, и не меньше своего пола', () => {
    // 1400×900: панель, утянутая до 651, рисуется на 558 — холсту его 342.
    expect(yieldToCanvas(651, 151, 900 - 342)).toBe(558);
    // Экран побольше: сохранённый размер работает целиком.
    expect(yieldToCanvas(651, 151, 1300 - 494)).toBe(651);
    // Не растянутое не трогается.
    expect(yieldToCanvas(151, 151, 558)).toBe(151);
    // Пол сильнее холста: тесный экран решает ступень, а не размер.
    expect(yieldToCanvas(651, 151, 100)).toBe(151);
    // 1024×768: колонка 480 рядом с правой в 254.4 — 1024 − 360 − 254.4.
    expect(yieldToCanvas(480, 134.4, 1024 - 360 - 254.4)).toBeCloseTo(409.6);
  });

  test('строка с блоком — не перенос клавиш', () => {
    expect(boxRow(['fps', 'transport', 'palette'])).toBe(true);
    expect(boxRow(['brush'])).toBe(true);
    expect(boxRow(['timeline'])).toBe(false);
    expect(boxRow(['fps', 'transport', 'add-frame'])).toBe(false);
    expect(TABLET_MIN_W).toBe(360);
  });

  test('ступень считается по базовому полу, а не по растянутому', () => {
    const effect = shell.slice(shell.indexOf('const bar = editor.panels.rows.length === 0'), shell.indexOf('step = pickStep('));
    expect(effect).toContain(': panelFloor;');
    expect(effect).not.toMatch(/panelHeight|editor\.sides\.\w+\.width \?\?/);
    expect(effect).toContain("sideBase('left')");
    expect(effect).toContain("sideBase('right')");
    const base = shell.slice(shell.indexOf('function sideBase('), shell.indexOf('$effect(', shell.indexOf('function sideBase(')));
    expect(base).toContain('Math.min(editor.sides[id].width ?? SIDE_REM[id] * rem, SIDE_REM[id] * rem)');
  });

  test('блок в строке поднимает панель, но не её базовый пол', () => {
    const wrap = shell.slice(shell.indexOf('const wrapExtra = $derived('), shell.indexOf('const panelFloor = $derived('));
    expect(wrap).toContain("row.includes('timeline') || boxRow(row)");
    expect(shell).toMatch(/const panelLow = \$derived\(yieldToCanvas\(panelFloor \+ boxExtra, panelFloor, panelRoom\)\);/);
    expect(shell).toMatch(/const panelHeight = \$derived\(yieldToCanvas\(editor\.panelHeight, panelLow, panelMax\)\);/);
  });

  test('разделители упираются в тот же предел и называют его', () => {
    expect(shell).toContain('resize.px = Math.min(resize.max, resize.size + (now - resize.from) * resize.sign);');
    expect(shell).toContain('editor.setPanelHeight(Math.min(panelMax, panelHeight + PANEL_STEP));');
    expect(shell).toContain('aria-valuemin={panelLow}');
    expect(shell).toContain('aria-valuemax={panelMax}');
    expect(shell).toContain('aria-valuemax={sideMax(id)}');
    expect(shell).not.toContain('aria-valuemax={SIDE_WIDTH_MAX}');
  });

  test('колонка рисуется уступившей, сохранённая ширина не переписывается', () => {
    const style = shell.slice(shell.indexOf('const sideStyle = '), shell.indexOf('const foldIcon'));
    expect(style).toContain('`width: ${sideWidth(id)}px`');
    expect(style).not.toContain('`width: ${editor.sides[id].width}px`');
  });
});

// Подсказка простоя — две строки, «Переносим…» — одна: с началом переноса
// полка уезжала из-под руки на 19px.
describe('плашка раскладки не прыгает с началом переноса', () => {
  test('подсказка держит две строки, а спрятанная — нет', () => {
    const hint = arranger.slice(arranger.indexOf('  .arrange-hint {'), arranger.indexOf('  .arrange-bar.compact .ws {'));
    expect(hint).toContain('min-height: 2.7em;');
    expect(hint.slice(hint.indexOf('.arrange-bar.compact .arrange-hint'))).toContain('min-height: 0;');
  });
});
