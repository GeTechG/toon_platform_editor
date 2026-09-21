/**
 * The register of what the editor can draw with.
 *
 * Built-in tools go in the same way external ones do — a separate door "for
 * ours" would leave the contract untested by the only people who use it every
 * day. A manifest that does not pass is skipped with a reason and never throws:
 * one bad plugin must not stop the editor from drawing.
 */

import { LINE_PRIMITIVES } from '../render/dispatch';
import { PLUGIN_API, type Plugin, type PluginTool } from './contract';

/**
 * What a call into a plugin gives back when the plugin threw instead: the
 * gesture ends as if a plain pencil had drawn it. The plugin is off by then,
 * so this is the one call that degrades, not a second way of drawing.
 */
type AnyFn = (...args: never[]) => unknown;


export interface RegisteredTool extends PluginTool {
  readonly id: string;
  readonly builtin: boolean;
}

export interface PluginFailure {
  readonly id: string;
  readonly reason: string;
}

/** A key is the same key whatever case it was written in. */
function keyId(key: string): string {
  return key.trim().toLowerCase();
}

function readTool(value: unknown): PluginTool | null {
  const tool = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  if (!tool || typeof tool.label !== 'string' || typeof tool.title !== 'string' || typeof tool.icon !== 'string') {
    return null;
  }
  return { ...tool, key: typeof tool.key === 'string' ? tool.key : '' } as PluginTool;
}

export class PluginRegistry {
  private readonly byId = new Map<string, RegisteredTool>();
  private readonly keys = new Set<string>();
  /** Plugins switched off by their own exception: id → why. */
  private readonly broken = new Map<string, string>();
  /** What did not load, for the settings list. */
  readonly failures: PluginFailure[] = [];
  /**
   * Told when a plugin breaks, so whoever holds its tool can drop it. The
   * register itself knows nothing of hands, windows or the pencil.
   */
  onBreak: ((id: string, reason: string) => void) | null = null;

  /** `reserved` — the keys the editor itself holds (Space, Ctrl+S and the rest). */
  constructor(reserved: Iterable<string> = []) {
    for (const key of reserved) {
      this.keys.add(keyId(key));
    }
  }

  /** The reason it did not load, or null when it did. */
  register(value: unknown, opts: { builtin?: boolean } = {}): string | null {
    const manifest = typeof value === 'object' && value !== null ? value as Partial<Plugin> : null;
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id) {
      return this.refuse('<без id>', 'манифеста нет или он без id');
    }
    if (manifest.api !== PLUGIN_API) {
      return this.refuse(manifest.id, `чужой мажор api: ${manifest.api}`);
    }
    if (this.byId.has(manifest.id)) {
      return this.refuse(manifest.id, 'такой id уже загружен');
    }
    const tool = readTool(manifest.tool);
    if (!tool) {
      return this.refuse(manifest.id, 'инструмент без label, title или icon');
    }
    if (tool.stroke) {
      if (!(LINE_PRIMITIVES as readonly string[]).includes(tool.stroke.kind)) {
        return this.refuse(manifest.id, `примитив, которого формат не знает: ${tool.stroke.kind}`);
      }
      if (typeof tool.stroke.descriptor !== 'function') {
        return this.refuse(manifest.id, 'инструмент рисует, но не строит дескриптор');
      }
    }
    // A taken key costs the key, not the tool: the drawing still works, and the
    // one that already had it keeps doing what it did.
    let key = tool.key;
    if (key && this.keys.has(keyId(key))) {
      this.failures.push({ id: manifest.id, reason: `клавиша занята: ${key}` });
      key = '';
    }
    if (key) {
      this.keys.add(keyId(key));
    }
    const builtin = opts.builtin ?? false;
    // A built-in tool is not wrapped: its exception is a bug of the editor,
    // and switching the pencil off would hide it rather than survive it.
    const guarded = builtin ? tool : this.guard(manifest.id, tool);
    this.byId.set(manifest.id, { ...guarded, key, id: manifest.id, builtin });
    return null;
  }

  /** Wraps every door into the plugin, so one exception costs the plugin only. */
  private guard(id: string, tool: PluginTool): PluginTool {
    const wrap = <F extends AnyFn>(fn: F, fallback: F): F =>
      ((...args: never[]) => {
        try {
          return fn(...args);
        } catch (error) {
          this.breakDown(id, error);
          return fallback(...args);
        }
      }) as F;
    const nothing = () => {};
    const stroke = tool.stroke;
    return {
      ...tool,
      ...(stroke
        ? {
            stroke: {
              ...stroke,
              // A pencil of the brush in hand: whatever the tool meant to lay
              // down, this much the format knows and the renderer draws.
              descriptor: wrap(stroke.descriptor, (brush) => ({
                kind: 'pencil',
                dialect: brush.dialect,
                width: brush.width,
                color: brush.color,
              })),
              ...(stroke.capture
                ? { capture: wrap(stroke.capture, (line, points) => [...line, ...points]) }
                : {}),
              ...(stroke.prepare ? { prepare: wrap(stroke.prepare, (points) => [...points]) } : {}),
              ...(stroke.commit
                ? { commit: wrap(stroke.commit, (points, descriptor) => ({ points: [...points], tool: descriptor })) }
                : {}),
            },
          }
        : {}),
      ...(tool.press ? { press: wrap(tool.press, nothing) } : {}),
      ...(tool.move ? { move: wrap(tool.move, nothing) } : {}),
      ...(tool.release ? { release: wrap(tool.release, nothing) } : {}),
      ...(tool.activate ? { activate: wrap(tool.activate, nothing) } : {}),
      ...(tool.deactivate ? { deactivate: wrap(tool.deactivate, nothing) } : {}),
    };
  }

  /**
   * A plugin threw: it is off for the rest of the session, with the whole
   * error in the console — the list only points there. Installed it stays, and
   * the next start gives it another chance: the failure may have been a one-off.
   */
  private breakDown(id: string, error: unknown): void {
    if (this.broken.has(id)) {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    this.broken.set(id, reason);
    console.error(`плагин ${id} отключён после ошибки:`, error);
    this.onBreak?.(id, reason);
  }

  /** Why a plugin is off, or undefined when it is not. */
  brokenReason(id: string): string | undefined {
    return this.broken.get(id);
  }

  /** Switches a broken plugin back on — the button beside it in the list. */
  enable(id: string): void {
    this.broken.delete(id);
  }

  private refuse(id: string, reason: string): string {
    this.fail(id, reason);
    return reason;
  }

  /** Writes down something that did not load, for the settings list and the log. */
  fail(id: string, reason: string): void {
    this.failures.push({ id, reason });
  }

  /** Takes a plugin out, freeing its key — what unloading one does. */
  remove(id: string): void {
    this.broken.delete(id);
    const tool = this.byId.get(id);
    if (tool?.key) {
      this.keys.delete(keyId(tool.key));
    }
    this.byId.delete(id);
  }

  tool(id: string): RegisteredTool | undefined {
    return this.broken.has(id) ? undefined : this.byId.get(id);
  }

  /** The tool a pressed key selects, if any holds it. */
  toolByKey(key: string): RegisteredTool | undefined {
    const wanted = keyId(key);
    return wanted ? this.tools().find((tool) => keyId(tool.key) === wanted) : undefined;
  }

  /** Every tool that works, in the order it was registered. */
  tools(): readonly RegisteredTool[] {
    return [...this.byId.values()].filter((tool) => !this.broken.has(tool.id));
  }
}
