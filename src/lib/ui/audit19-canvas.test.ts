import { describe, expect, it } from 'bun:test';

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

// Второй палец щипка приносит pointerenter — кольцо прыгало под него и стояло
// там, пока пальцы не двинутся (владелец, после 18-го аудита: под пальцами,
// что двигают лист, кольца нет).
describe('кольцо кисти под пальцем, начавшим щипок или панораму', () => {
  it('гаснет сразу, не дожидаясь первого движения', () => {
    const down = handler('onPointerDown');
    expect(down).toMatch(/if \(startNavigation\(e\)\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(movesView\(e\)\) \{\s*cursorVisible = false;/);
  });
});
