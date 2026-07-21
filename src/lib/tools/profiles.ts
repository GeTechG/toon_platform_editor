import { FIXED_POINT_SCALE } from '../format/constants';
import type { StrokeDialect, ToolDescriptor } from '../format/types';
import type { ResolvedStroke } from '../model/operations';
import { StrokeBuilder } from './stroke-builder';

export interface PointerSample {
  pointerId: number;
  isPrimary: boolean;
  /** Float coordinates in fixed-point document units. */
  x: number;
  y: number;
  /** Already unpacked coalesced samples, when supported. */
  coalesced?: PointerSample[];
}

export interface TonioSettings {
  smooth: number;
  minDistance: number;
}

export const DEFAULT_TONIO_SETTINGS: Readonly<TonioSettings> = { smooth: 3, minDistance: 3 };
/** Native width of the source Tonio drawing canvas. */
export const TONIO_CANVAS_WIDTH = 1280;

export interface StrokeSession {
  readonly profile: StrokeDialect;
  readonly pointerId: number;
  readonly descriptor: ToolDescriptor;
  readonly rawPoints: number[];
  readonly tonio: Readonly<TonioSettings>;
  readonly tonioCoordinateScale: number;
  readonly multator?: StrokeBuilder;
}

export function beginStrokeSession(
  profile: StrokeDialect,
  event: PointerSample,
  descriptor: ToolDescriptor,
  tonio: TonioSettings = DEFAULT_TONIO_SETTINGS,
  tonioCoordinateScale = 1,
): StrokeSession {
  const frozenDescriptor = copyTool({ ...descriptor, dialect: profile });
  if (profile === 'multator') {
    const builder = new StrokeBuilder({
      width: frozenDescriptor.width,
      color: frozenDescriptor.kind === 'pencil' ? frozenDescriptor.color : '#000000',
      erase: frozenDescriptor.kind === 'eraser',
    });
    builder.addPoint(event.x, event.y);
    return {
      profile,
      pointerId: event.pointerId,
      descriptor: frozenDescriptor,
      rawPoints: builder.rawPoints as number[],
      tonio: { ...tonio },
      tonioCoordinateScale: 1,
      multator: builder,
    };
  }
  const session: StrokeSession = {
    profile,
    pointerId: event.pointerId,
    descriptor: frozenDescriptor,
    rawPoints: [],
    tonio: { smooth: clampInteger(tonio.smooth, 1, 100), minDistance: clampInteger(tonio.minDistance, 0, 30) },
    tonioCoordinateScale: positiveScale(tonioCoordinateScale),
  };
  appendTonioEventBatch(session, event);
  return session;
}

export function appendStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId) return;
  if (session.profile === 'multator') {
    session.multator!.addPoint(event.x, event.y);
    return;
  }
  appendTonioEventBatch(session, event);
}

/** Tonio uses a non-empty coalesced pointerup batch, otherwise the main event. */
export function finishStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId || session.profile !== 'toonio') return;
  appendTonioEventBatch(session, event);
}

export function previewStrokeSession(session: StrokeSession): readonly number[] {
  return session.profile === 'toonio'
    ? tonioSmooth(session.rawPoints, session.tonio.smooth)
    : session.rawPoints;
}

export function commitStrokeSession(session: StrokeSession): ResolvedStroke {
  const points = session.profile === 'multator'
    ? session.multator!.commit().points
    : tonioPrepare(
        tonioSmooth(session.rawPoints, session.tonio.smooth),
        session.tonio.minDistance,
        1,
        session.tonioCoordinateScale,
      );
  return { points, tool: copyTool(session.descriptor) };
}

export function quantizeTonioPoint(xDoc: number, yDoc: number): [number, number] {
  return [Math.trunc(xDoc / FIXED_POINT_SCALE) * FIXED_POINT_SCALE, Math.trunc(yDoc / FIXED_POINT_SCALE) * FIXED_POINT_SCALE];
}

export function tonioSmooth(points: readonly number[], smooth: number): number[] {
  if (points.length === 0) return [];
  const result = [points[0], points[1]];
  const step = clampInteger(smooth, 1, 100) * 2;
  for (let i = 2; i < points.length - 2; i += step) result.push(points[i], points[i + 1]);
  const x = points[points.length - 2];
  const y = points[points.length - 1];
  result.push(x, y, x, y);
  return result;
}

export function tonioPrepare(
  points: readonly number[],
  minDistance: number,
  zoom: number,
  coordinateScale = 1,
): number[] {
  if (points.length <= 2) return points.slice();
  const result = [points[0], points[1]];
  const threshold = (clampInteger(minDistance, 0, 30) * FIXED_POINT_SCALE) / (zoom * positiveScale(coordinateScale));
  for (let i = 2; i < points.length - 2; i += 2) {
    const distance = Math.hypot(points[i - 2] - points[i], points[i - 1] - points[i + 1]);
    if (distance > threshold) result.push(points[i], points[i + 1]);
  }
  const x = points[points.length - 2];
  const y = points[points.length - 1];
  result.push(x, y, x, y);
  return result;
}

export class PointerStrokeController {
  #session: StrokeSession | null = null;
  #committed: ResolvedStroke | null = null;

  constructor(
    private readonly selection: () => {
      profile: StrokeDialect;
      descriptor: ToolDescriptor;
      tonio?: TonioSettings;
      tonioCoordinateScale?: number;
    },
  ) {}

  get session(): StrokeSession | null { return this.#session; }

  pointerDown(event: PointerSample): boolean {
    if (!event.isPrimary || this.#session) return false;
    const selected = this.selection();
    this.#session = beginStrokeSession(
      selected.profile,
      event,
      selected.descriptor,
      selected.tonio,
      selected.tonioCoordinateScale,
    );
    return true;
  }

  pointerMove(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    appendStrokeEvent(this.#session, event);
    return true;
  }

  pointerUp(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    finishStrokeEvent(this.#session, event);
    this.#committed = commitStrokeSession(this.#session);
    this.#session = null;
    return true;
  }

  pointerCancel(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    if (this.#session.profile === 'toonio') {
      this.#committed = commitStrokeSession(this.#session);
    }
    this.#session = null;
    return true;
  }

  takeCommitted(): ResolvedStroke | null {
    const stroke = this.#committed;
    this.#committed = null;
    return stroke;
  }
}

function appendTonioEventBatch(session: StrokeSession, event: PointerSample): void {
  const coalesced = event.coalesced?.filter((sample) => sample.pointerId === session.pointerId);
  const samples = coalesced && coalesced.length > 0 ? coalesced : [event];
  let previousX: number | undefined;
  let previousY: number | undefined;
  for (const sample of samples) {
    const [x, y] = quantizeTonioPoint(sample.x, sample.y);
    if (x === previousX && y === previousY) continue;
    session.rawPoints.push(x, y);
    previousX = x;
    previousY = y;
  }
}

function copyTool(tool: ToolDescriptor): ToolDescriptor {
  return tool.kind === 'pencil'
    ? { kind: 'pencil', dialect: tool.dialect, width: tool.width, color: tool.color }
    : { kind: 'eraser', dialect: tool.dialect, width: tool.width };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function positiveScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
