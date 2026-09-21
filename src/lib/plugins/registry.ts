/**
 * The register of what the editor can draw with.
 *
 * Built-in tools go in the same way external ones do — a separate door "for
 * ours" would leave the contract untested by the only people who use it every
 * day. A manifest that does not pass is skipped with a reason and never throws:
 * one bad plugin must not stop the editor from drawing.
 */

import { LINE_PRIMITIVES } from '../render/dispatch';
import {
  PLUGIN_API,
  pluginText,
  type Plugin,
  type PluginBrush,
  type PluginBrushType,
  type PluginPreset,
  type PluginTool,
  type StrokeRules,
} from './contract';
import { BASE_LOCALE, i18n, t } from '../i18n';

/**
 * A manifest's text, resolved for the language in hand.
 *
 * ponytail: resolved once, on accept — so a language switched while the editor
 * is open leaves plugin labels in the old one. Re-registering what `store.ts`
 * already holds is the upgrade path, and it is the existing install path, not
 * a new mechanism; it stays unwritten while nothing can switch the language.
 */
function localized(value: unknown): string | null {
  return pluginText(value, i18n.language, BASE_LOCALE);
}

/**
 * What a call into a plugin gives back when the plugin threw instead: the
 * gesture ends as if a plain pencil had drawn it. The plugin is off by then,
 * so this is the one call that degrades, not a second way of drawing.
 */
type AnyFn = (...args: never[]) => unknown;


export interface RegisteredTool extends Omit<PluginTool, 'label' | 'title'> {
  /** Resolved out of the manifest for the language in hand. */
  readonly label: string;
  readonly title: string;
  readonly id: string;
  /** The plugin that brought it — who may hide it is decided by this. */
  readonly plugin: string;
  readonly builtin: boolean;
}

export interface RegisteredPreset extends Omit<PluginPreset, 'label'> {
  readonly label: string;
  readonly id: string;
  readonly plugin: string;
}

export interface RegisteredBrushType extends Omit<PluginBrushType, 'label' | 'hint'> {
  readonly label: string;
  readonly hint?: string;
  readonly id: string;
  readonly plugin: string;
}

/** The brush a rule set is probed with: its canvas and ranges MUST NOT read it. */
const PROBE: PluginBrush = { width: 1, color: '#000000', fill: '#ffffff', smooth: 1, minDistance: 0 };

export interface PluginFailure {
  readonly id: string;
  readonly reason: string;
}

/** A manifest record, or undefined when the field is absent or not an object. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0
    ? value as Record<string, unknown>
    : undefined;
}

/** A key is the same key whatever case it was written in. */
function keyId(key: string): string {
  return key.trim().toLowerCase();
}

function readTool(value: unknown): RegisteredText<PluginTool> | null {
  const tool = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  const label = tool && localized(tool.label);
  const title = tool && localized(tool.title);
  if (!tool || !label || !title || typeof tool.icon !== 'string') {
    return null;
  }
  return { ...tool, label, title, key: typeof tool.key === 'string' ? tool.key : '' } as RegisteredText<PluginTool>;
}

/** The same shape with its text resolved: what the rest of the editor reads. */
type RegisteredText<T> = Omit<T, 'label' | 'title' | 'hint'> & {
  label: string;
  title: string;
  hint?: string;
};

export class PluginRegistry {
  private readonly byId = new Map<string, RegisteredTool>();
  private readonly presetById = new Map<string, RegisteredPreset>();
  private readonly typeById = new Map<string, RegisteredBrushType>();
  private readonly keys = new Set<string>();
  /** Plugins switched off by their own exception: id → why. */
  private readonly broken = new Map<string, string>();
  /**
   * What came in the editor's own delivery. Such a plugin goes through every
   * check the others do and breaks the same way, but the user cannot take it
   * off: it is not a choice they made, it is what the editor is.
   */
  private readonly delivered = new Set<string>();
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
  register(value: unknown, opts: { builtin?: boolean; bundled?: boolean } = {}): string | null {
    const manifest = typeof value === 'object' && value !== null ? value as Partial<Plugin> : null;
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id) {
      return this.refuse(t('plugin.unnamed'), t('plugin.no_manifest'));
    }
    if (manifest.api !== PLUGIN_API) {
      return this.refuse(manifest.id, t('plugin.foreign_api', { api: manifest.api }));
    }
    const tools = record(manifest.tools);
    const presets = record(manifest.presets);
    const types = record(manifest.brushTypes);
    if (!tools && !presets && !types) {
      return this.refuse(manifest.id, t('plugin.brings_nothing'));
    }
    const plugin = manifest.id;
    // A record that does not pass costs itself, not the manifest: a plugin of
    // seven tools must not lose six because one asked for a taken id. A
    // manifest of which nothing at all passed is a refused install, though,
    // so the first reason comes back to whoever was installing it.
    if (opts.bundled) {
      this.delivered.add(manifest.id);
    }
    const was = this.failures.length;
    let accepted = 0;
    for (const [id, value] of Object.entries(tools ?? {})) {
      accepted += this.addTool(plugin, id, value, opts.builtin ?? false) ? 1 : 0;
    }
    for (const [id, value] of Object.entries(presets ?? {})) {
      accepted += this.addPreset(plugin, id, value) ? 1 : 0;
    }
    for (const [id, value] of Object.entries(types ?? {})) {
      accepted += this.addBrushType(plugin, id, value) ? 1 : 0;
    }
    return accepted === 0 ? this.failures[was]?.reason ?? t('plugin.nothing_worked') : null;
  }

  private addTool(plugin: string, id: string, value: unknown, builtin: boolean): boolean {
    if (this.byId.has(id)) {
      this.fail(plugin, t('plugin.id_taken', { id }));
      return false;
    }
    const tool = readTool(value);
    if (!tool) {
      this.fail(plugin, t('plugin.tool_incomplete', { id }));
      return false;
    }
    if (tool.stroke) {
      if (!(LINE_PRIMITIVES as readonly string[]).includes(tool.stroke.kind)) {
        this.fail(plugin, t('plugin.unknown_primitive', { kind: tool.stroke.kind }));
        return false;
      }
      if (typeof tool.stroke.descriptor !== 'function') {
        this.fail(plugin, t('plugin.tool_no_descriptor', { id }));
        return false;
      }
    }
    // A taken key costs the key, not the tool: the drawing still works, and the
    // one that already had it keeps doing what it did.
    let key = tool.key;
    if (key && this.keys.has(keyId(key))) {
      this.fail(plugin, t('plugin.key_taken', { key }));
      key = '';
    }
    if (key) {
      this.keys.add(keyId(key));
    }
    // A built-in tool is not wrapped: its exception is a bug of the editor,
    // and switching the pencil off would hide it rather than survive it.
    const guarded = builtin ? tool : this.guard(plugin, tool);
    this.byId.set(id, { ...guarded, key, id, plugin, builtin });
    return true;
  }

  private addPreset(plugin: string, id: string, value: unknown): boolean {
    const preset = value as PluginPreset | null;
    const label = preset && localized(preset.label);
    if (!preset || !label || typeof preset.brush !== 'string' || !preset.ux) {
      this.fail(plugin, t('plugin.preset_incomplete', { id }));
      return false;
    }
    if (this.presetById.has(id)) {
      this.fail(plugin, t('plugin.preset_taken', { id }));
      return false;
    }
    this.presetById.set(id, { ...preset, label, id, plugin });
    return true;
  }

  private addBrushType(plugin: string, id: string, value: unknown): boolean {
    const type = value as PluginBrushType | null;
    const label = type && localized(type.label);
    if (!type || !label || typeof type.twins !== 'object' || !type.twins) {
      this.fail(plugin, t('plugin.brush_type_incomplete', { id }));
      return false;
    }
    if (this.typeById.has(id)) {
      this.fail(plugin, t('plugin.brush_type_taken', { id }));
      return false;
    }
    this.typeById.set(id, { ...type, label, hint: localized(type.hint) ?? undefined, id, plugin });
    return true;
  }

  /** Wraps every door into the plugin, so one exception costs the plugin only. */
  private guard(id: string, tool: RegisteredText<PluginTool>): RegisteredText<PluginTool> {
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
    /** Every function of a rule set, guarded the same way the manifest is. */
    const guardRules = (
      rules: StrokeRules | undefined,
      guardFn: <F extends AnyFn>(fn: F, fallback: F) => F,
    ): StrokeRules | undefined => {
      if (!rules) return undefined;
      const keep = (line: readonly number[]) => [...line];
      return {
        ...rules,
        capture: guardFn(rules.capture, (line, batch) => [...line, ...batch]),
        ...(rules.release ? { release: guardFn(rules.release, keep) } : {}),
        ...(rules.preview ? { preview: guardFn(rules.preview, keep) } : {}),
        ...(rules.prepare ? { prepare: guardFn(rules.prepare, keep) } : {}),
        ...(rules.path ? { path: guardFn(rules.path, keep) } : {}),
        ...(rules.commit
          ? {
              commit: guardFn(rules.commit, (points, descriptor) => ({
                points: [...points],
                tool: descriptor,
              })),
            }
          : {}),
      };
    };
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
                geometry: 'smooth',
                width: brush.width,
                color: brush.color,
              })),
              // Rules that throw cost the plugin its own rules, not the
              // gesture: the brush the preset picked takes over instead.
              ...(stroke.rules
                ? {
                    rules: wrap(
                      (brush: PluginBrush) => guardRules(stroke.rules!(brush), wrap),
                      () => undefined,
                    ),
                  }
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
    console.error(t('plugin.broken', { id }), error);
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

  /** Whether a plugin came in the editor's delivery, and so cannot be taken off. */
  isBundled(id: string): boolean {
    return this.delivered.has(id);
  }

  /**
   * Takes a plugin out with everything it brought, freeing its keys. What
   * came in the delivery stays: it changes with the editor, not past it.
   */
  remove(plugin: string): void {
    if (this.delivered.has(plugin)) {
      return;
    }
    this.broken.delete(plugin);
    for (const [id, tool] of [...this.byId]) {
      if (tool.plugin !== plugin) continue;
      if (tool.key) {
        this.keys.delete(keyId(tool.key));
      }
      this.byId.delete(id);
    }
    for (const [id, preset] of [...this.presetById]) {
      if (preset.plugin === plugin) this.presetById.delete(id);
    }
    for (const [id, type] of [...this.typeById]) {
      if (type.plugin === plugin) this.typeById.delete(id);
    }
  }

  tool(id: string): RegisteredTool | undefined {
    const tool = this.byId.get(id);
    return tool && this.broken.has(tool.plugin) ? undefined : tool;
  }

  /** The tool a pressed key selects, if any holds it. */
  toolByKey(key: string): RegisteredTool | undefined {
    const wanted = keyId(key);
    return wanted ? this.tools().find((tool) => keyId(tool.key) === wanted) : undefined;
  }

  /** Every tool that works, in the order it was registered. */
  tools(): readonly RegisteredTool[] {
    return [...this.byId.values()].filter((tool) => !this.broken.has(tool.plugin));
  }

  preset(id: string): RegisteredPreset | undefined {
    const preset = this.presetById.get(id);
    return preset && this.broken.has(preset.plugin) ? undefined : preset;
  }

  presets(): readonly RegisteredPreset[] {
    return [...this.presetById.values()].filter((preset) => !this.broken.has(preset.plugin));
  }

  brushType(id: string): RegisteredBrushType | undefined {
    const type = this.typeById.get(id);
    return type && this.broken.has(type.plugin) ? undefined : type;
  }

  brushTypes(): readonly RegisteredBrushType[] {
    return [...this.typeById.values()].filter((type) => !this.broken.has(type.plugin));
  }

  /** The rules of a brush, read with a neutral record (see `PROBE`). */
  probeRules(id: string): StrokeRules | undefined {
    return this.tool(id)?.stroke?.rules?.(PROBE);
  }
}
