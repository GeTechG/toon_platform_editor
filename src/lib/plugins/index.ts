/**
 * The editor's one register of plugins. Its own tools and the plugin it ships
 * with are in it from the start; whatever is installed joins them later
 * (see `install.ts`).
 */

import corePlugin from '../../core-plugin';
import { BUILTIN_PLUGIN, RESERVED_KEYS } from './builtins';
import { PluginRegistry } from './registry';

export const plugins = new PluginRegistry(RESERVED_KEYS);

plugins.register(BUILTIN_PLUGIN, { builtin: true });
/**
 * The delivery: one plugin, built with the editor and registered right after
 * its own tools, through the very door an installed plugin comes through. It
 * is the editor's only way of knowing that `core` exists — nothing under
 * `lib/` imports anything else from that folder.
 */
plugins.register(corePlugin, { bundled: true });

/** What the list of «Мои» shows for the delivery. */
export const BUNDLED_PLUGIN = corePlugin;

/**
 * Whether a tool interrupts drawing instead of replacing it (reference
 * `helpTool`). The trait comes from the tool's own manifest, not from a list
 * of names anywhere — a plugin says it about itself.
 */
export function isHelpTool(tool: string): boolean {
  return plugins.tool(tool)?.help === true;
}

export { PENCIL } from './builtins';
export { PLUGIN_API } from './contract';
export type {
  Plugin,
  PluginBrush,
  PluginBrushType,
  PluginHost,
  PluginPoint,
  PluginPreset,
  PluginPrimitive,
  PluginStroke,
  PluginTool,
  UxProfile,
} from './contract';
export type { PluginFailure, RegisteredBrushType, RegisteredPreset, RegisteredTool } from './registry';
