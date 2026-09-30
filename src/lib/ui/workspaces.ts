/**
 * Named arrangements: a whole panel layout (and where the floating windows
 * sit) saved under a name, so one machine can keep «Планшет» and «Стол» and
 * switch between them. Stored on their own key, like the saved palettes —
 * they outlive any one preset.
 */

import { normalizePanels, samePanels, type PanelLayout } from './panels';
import { t } from '../i18n';
import { cutText } from '../format/constants';

export interface FloatPositions {
  [id: string]: { x: number; y: number };
}

export interface Workspace {
  id: number;
  name: string;
  panels: PanelLayout;
  floatPos: FloatPositions;
}

export const WORKSPACES_KEY = 'toon-editor:workspaces';
/** The longest name an arrangement keeps (owner, 14th audit): the field, a file, storage. */
export const MAX_WORKSPACE_NAME = 40;

/** A name as stored: trimmed, cut to the limit without splitting a character, trimmed again. */
export function workspaceName(raw: string): string {
  return cutText(raw.trim(), MAX_WORKSPACE_NAME).trim();
}
/**
 * The largest file «Загрузить…» reads, in bytes. A saved arrangement is a
 * couple of kilobytes; a video picked by mistake was read whole and took the
 * tab down with the drawing in it.
 */
export const WORKSPACE_FILE_MAX = 256 * 1024;

/** The largest id in the list, 0 for none — a loop: `Math.max(...ids)` threw past 65 536 of them (JSC). */
function maxId(ids: Iterable<number>): number {
  let max = 0;
  for (const id of ids) {
    if (id > max) {
      max = id;
    }
  }
  return max;
}
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
      // Never past the top-left edge, as the UI config reads it (presets.ts):
      // read otherwise, the reload moved the window and the arrangement «changed».
      out[id] = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
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
  // A repeated id broke the bar's keyed list; a missing or taken one gets the next free.
  const taken = new Set<number>();
  const stored = data
    .map((e) => (e as { id?: unknown } | null)?.id)
    .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
  const fresh = (): number => Math.max(maxId(taken), maxId(stored)) + 1;
  return data.flatMap((entry): Workspace[] => {
    const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const name = typeof row.name === 'string' ? workspaceName(row.name) : '';
    if (name === '') {
      return [];
    }
    const id = typeof row.id === 'number' && Number.isFinite(row.id) && !taken.has(row.id) ? row.id : fresh();
    taken.add(id);
    return [{
      id,
      // As «Сохранить» names it: «Стол » from a file was another «Стол»; a
      // name past the limit is cut, and a clash that makes is asked about.
      name,
      // Read before the installed plugins are, like the live layout: a key of
      // a plugin still loading keeps its place (refreshPlugins cleans later).
      panels: normalizePanels(row.panels, true),
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
  const id = at >= 0 ? list[at].id : maxId(list.map((w) => w.id)) + 1;
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

/**
 * The workspace the list shows as picked: the one picked, while the panels
 * are still laid out as it is. Rearranged, reset or gone, the list says
 * «— раскладка —» — it read «Стол» over another arrangement, and «Скачать»
 * then saved the stored «Стол» instead of what was on the screen.
 */
export function pickedWorkspace(
  picked: string,
  list: readonly Workspace[],
  panels: PanelLayout,
  floatPos: FloatPositions,
): string {
  const workspace = picked ? list.find((w) => String(w.id) === picked) : undefined;
  return workspace && samePanels(panels, workspace.panels, floatPos, workspace.floatPos) ? picked : '';
}

export function removeWorkspace(list: readonly Workspace[], id: number): Workspace[] {
  return list.filter((workspace) => workspace.id !== id);
}

/**
 * Loads the saved workspaces. Another tab may have saved or deleted one since
 * this list was read, so every change starts here. Storage that cannot be
 * read, or holds nothing, gives `fallback` back: the list in memory may be
 * the only copy there is (a write that failed).
 */
export function loadWorkspaces(fallback: Workspace[] = []): Workspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_KEY);
    return raw === null ? fallback : parseWorkspaces(raw);
  } catch {
    return fallback;
  }
}

/** Persists them. Best-effort — never throws. */
export function saveWorkspaces(list: readonly Workspace[]): void {
  try {
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(list));
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

/**
 * The names such a file would replace with another arrangement: the same name
 * here, laid out otherwise or with its windows elsewhere. Asked about first,
 * as «Сохранить» asks (owner, 13th audit).
 */
export function workspaceConflicts(list: readonly Workspace[], raw: string): string[] {
  return parseWorkspaces(raw).flatMap((workspace) => {
    const same = list.find((w) => w.name === workspace.name);
    return same && !samePanels(same.panels, workspace.panels, same.floatPos, workspace.floatPos)
      ? [workspace.name]
      : [];
  });
}

/**
 * Reads such a file, merging by name; anything unreadable loads nothing. The
 * names in `keep` stay as they are here (the question got a «no»).
 */
export function importWorkspaces(
  list: readonly Workspace[],
  raw: string,
  keep: ReadonlySet<string> = new Set(),
): { workspaces: Workspace[]; loaded: number } {
  const loaded = parseWorkspaces(raw).filter((workspace) => !keep.has(workspace.name));
  let workspaces = [...list];
  for (const workspace of loaded) {
    workspaces = withWorkspace(workspaces, workspace.name, workspace.panels, workspace.floatPos);
  }
  return { workspaces, loaded: loaded.length };
}
