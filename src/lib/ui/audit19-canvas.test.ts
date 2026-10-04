import { describe, expect, it } from 'bun:test';
import { shotCovers, type DrawnView, type Stage } from './viewport';

// Девятнадцатый аудит, холст: снимок панорамы, который не покрывает то, что
// рука вывела на стол; снимок, взятый посреди просмотра; кольцо под пальцем,
// начавшим щипок. CanvasView — компонент на рунах: чистое правило проверяется
// вызовом, обязанности компонента — по исходнику.

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`нет обработчика ${name}`);
  return match[0];
}

// Стол 1000×600, лист на 100 % — 800×450, лежит посередине (100, 75).
const stage: Stage = { width: 1000, height: 600, sheetWidth: 800, sheetHeight: 450, sheetX: 100, sheetY: 75 };
const view = (zoom: number, panX: number, panY: number): DrawnView => ({ zoom, panX, panY, dpr: 1 });

// Снимок — это стол, каким он был, когда рука взялась: при 300 % на нём треть
// листа. Рука тянет лист — и выехавшая на стол часть рисунка была пустой
// бумагой, пока не отпустишь: не видно, куда ведёшь.
describe('снимок панорамы покрывает не весь лист', () => {
  it('лист целиком был на столе — снимок покрывает его, куда бы ни уехал', () => {
    expect(shotCovers(view(1, 100, 75), view(1, 300, 75), stage)).toBe(true);
    expect(shotCovers(view(1, 100, 75), view(1, -200, -100), stage)).toBe(true);
  });

  it('увеличенный лист сдвинут — выехавшей части на снимке нет', () => {
    expect(shotCovers(view(3, -700, -375), view(3, -500, -375), stage)).toBe(false);
    expect(shotCovers(view(3, -700, -375), view(3, -700, -475), stage)).toBe(false);
  });

  it('щипок на увеличение показывает часть снимка — покрыт', () => {
    // 300 % → 600 % вокруг середины стола (500, 300).
    expect(shotCovers(view(3, -700, -375), view(6, -1900, -1050), stage)).toBe(true);
  });

  it('щипок на уменьшение открывает лист вокруг снимка — не покрыт', () => {
    // 300 % → 150 % вокруг середины стола.
    expect(shotCovers(view(3, -700, -375), view(1.5, -100, -37.5), stage)).toBe(false);
  });

  it('тот же вид — покрыт: дрожь в долю пикселя кадр не пересобирает', () => {
    expect(shotCovers(view(3, -700, -375), view(3, -700, -375), stage)).toBe(true);
    expect(shotCovers(view(3, -700, -375), view(3, -699.5, -375), stage)).toBe(true);
  });

  it('холст дособирает кадр под рукой, но не чаще, чем раз в NAV_COMPOSE_MS', () => {
    const draw = handler('draw');
    expect(draw).toContain('shotCovers(navShot.view, drawn, stage)');
    expect(draw).toMatch(/performance\.now\(\) - navShot\.at >= NAV_COMPOSE_MS/);
    // Рано — снимок остаётся, а кадр спрашивается снова: рука, что замерла,
    // не оставляет пустую полосу до отпускания.
    expect(draw).toMatch(/if \(uncovered && shot\) \{\s*scheduleDraw\(\);/);
    expect(handler('takeNavShot')).toContain('at: performance.now()');
  });
});

// Во время просмотра снимок не показывается (кадры идут), а брался на каждое
// событие колеса заново — смена кадра его сбрасывала: копия всего стола
// по разу на кадр фильма, ни разу не нарисованная.
describe('снимок посреди просмотра', () => {
  it('не берётся: показывать его некому', () => {
    const take = handler('takeNavShot');
    expect(take).toMatch(/if \(editor\.playing\) \{\s*return;/);
    expect(take.indexOf('editor.playing')).toBeLessThan(take.indexOf('drawImage('));
  });
});

// Второй палец щипка приносит pointerenter — кольцо прыгало под него и стояло
// там, пока пальцы не двинутся (владелец, после 18-го аудита: под пальцами,
// что двигают лист, кольца нет).
describe('кольцо кисти под пальцем, начавшим щипок или панораму', () => {
  it('гаснет сразу, не дожидаясь первого движения', () => {
    const down = handler('onPointerDown');
    expect(down).toMatch(/if \(startNavigation\(e\)\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(movesView\(e\)\) \{\s*cursorVisible = false;/);
  });
});
