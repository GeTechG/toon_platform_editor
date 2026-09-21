/**
 * Named arrangements: a whole panel layout (and where the floating windows
 * sit) saved under a name, so one machine can keep «Планшет» and «Стол» and
 * switch between them. Stored on their own key, like the saved palettes —
 * they outlive any one preset.
 */

import { normalizePanels, type PanelLayout } from './panels';
import { t } from '../i18n';

export interface FloatPositions {
  [id: string]: { x: number; y: number };
}

export interface Workspace {
  id: number;
  name: string;
  panels: PanelLayout;
  floatPos: FloatPositions;
}

const STORAGE_KEY = 'toon-editor:workspaces';
/** What the live arrangement is called when it is exported unnamed. */
export const currentName = (): string => t('workspace.current');

function cleanFloatPos(value: unknown): FloatPositions {
  const out: FloatPositions = {};
  if (typeof value !== 'object' || value === null) {
    return out;
  }
  for (const [id, pos] of Object.entries(value as Record<string, unknown>)) {
    const { x, y } = (typeof pos === 'object' && pos !== null ? pos : {}) as Record<string, unknown>;
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      out[id] = { x: Math.round(x), y: Math.round(y) };
    }
  }
  return out;
}

/** Stored workspaces, cleaned; anything unreadable is simply not a workspace. */
export function parseWorkspaces(raw: string | null): Workspace[] {
  if (!raw) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((entry, i): Workspace[] => {
    const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      return [];
    }
    return [{
      id: typeof row.id === 'number' && Number.isFinite(row.id) ? row.id : i + 1,
      name: row.name,
      panels: normalizePanels(row.panels),
      floatPos: cleanFloatPos(row.floatPos),
    }];
  });
}

/** Saves under `name`, replacing a workspace of that name where it already is. */
export function withWorkspace(
  list: readonly Workspace[],
  name: string,
  panels: PanelLayout,
  floatPos: FloatPositions,
): Workspace[] {
  const at = list.findIndex((workspace) => workspace.name === name);
  const id = at >= 0 ? list[at].id : Math.max(0, ...list.map((w) => w.id)) + 1;
  const saved: Workspace = {
    id,
    name,
    panels: structuredClone(panels),
    floatPos: cleanFloatPos(floatPos),
  };
  if (at < 0) {
    return [...list, saved];
  }
  const next = [...list];
  next[at] = saved;
  return next;
}

export function removeWorkspace(list: readonly Workspace[], id: number): Workspace[] {
  return list.filter((workspace) => workspace.id !== id);
}

/** Loads the saved workspaces, or none on any failure. */
export function loadWorkspaces(): Workspace[] {
  try {
    return parseWorkspaces(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Persists them. Best-effort — never throws. */
export function saveWorkspaces(list: readonly Workspace[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // private mode / blocked storage — degrade to no-op.
  }
}

/** One arrangement as a file — a list of one, so loading it is loading a file. */
export function exportWorkspace(
  name: string,
  panels: PanelLayout,
  floatPos: FloatPositions,
): string {
  return JSON.stringify(withWorkspace([], name, panels, floatPos), null, 2);
}

/** Reads such a file, merging by name; anything unreadable loads nothing. */
export function importWorkspaces(
  list: readonly Workspace[],
  raw: string,
): { workspaces: Workspace[]; loaded: number } {
  const loaded = parseWorkspaces(raw);
  let workspaces = [...list];
  for (const workspace of loaded) {
    workspaces = withWorkspace(workspaces, workspace.name, workspace.panels, workspace.floatPos);
  }
  return { workspaces, loaded: loaded.length };
}
