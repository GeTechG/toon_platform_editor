import { describe, expect, it } from 'bun:test';
import { ZOOM_MAX, ZOOM_MIN, zoomCentredOn, zoomDelta, type Stage } from './viewport';

// Двадцать первый аудит, холст. Найдено живым прогоном: колесо у предела
// масштаба.

const stage: Stage = { width: 891, height: 649, sheetWidth: 859, sheetHeight: 483 };

// Колесо центрирует вид на курсоре (эталонный NormalizeCoords) — это часть
// зума. У предела зума нет, а лист всё равно ехал: каждый лишний щелчок
// колеса сдвигал его на расстояние от курсора до середины стола, пока лист
// не упирался в край (на 1000 % и на 10 % — до полоски в 64 px).
describe('колесо у предела масштаба', () => {
  it('на 1000 % щелчок «ближе» вид не меняет', () => {
    const view = { zoom: ZOOM_MAX, panX: -3000, panY: -2000 };
    expect(zoomCentredOn(view, view.zoom + zoomDelta(view.zoom, 1), 365, 300, stage)).toBe(view);
  });

  it('на 10 % щелчок «дальше» вид не меняет', () => {
    const view = { zoom: ZOOM_MIN, panX: 400, panY: 300 };
    expect(zoomCentredOn(view, view.zoom + zoomDelta(view.zoom, -1), 100, 100, stage)).toBe(view);
  });

  it('щелчок обратно от предела зумит и центрирует, как прежде', () => {
    const view = { zoom: ZOOM_MAX, panX: -3000, panY: -2000 };
    const next = zoomCentredOn(view, view.zoom + zoomDelta(view.zoom, -1), 365, 300, stage);
    expect(next.zoom).toBe(9.5);
    expect(next).not.toBe(view);
  });
});
