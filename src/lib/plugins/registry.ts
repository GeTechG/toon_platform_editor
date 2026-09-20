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
  /** What did not load, for the settings list. */
  readonly failures: PluginFailure[] = [];

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
    this.byId.set(manifest.id, { ...tool, key, id: manifest.id, builtin: opts.builtin ?? false });
    return null;
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
    const tool = this.byId.get(id);
    if (tool?.key) {
      this.keys.delete(keyId(tool.key));
    }
    this.byId.delete(id);
  }

  /** Forgets everything that came from an address — what rereading one starts with. */
  resetExternal(): void {
    for (const tool of this.tools()) {
      if (!tool.builtin) {
        this.remove(tool.id);
      }
    }
    this.failures.length = 0;
  }

  tool(id: string): RegisteredTool | undefined {
    return this.byId.get(id);
  }

  /** The tool a pressed key selects, if any holds it. */
  toolByKey(key: string): RegisteredTool | undefined {
    const wanted = keyId(key);
    return wanted ? this.tools().find((tool) => keyId(tool.key) === wanted) : undefined;
  }

  /** Every tool, in the order it was registered. */
  tools(): readonly RegisteredTool[] {
    return [...this.byId.values()];
  }
}
