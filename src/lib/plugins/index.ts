/**
 * The editor's one register of plugins. Built-ins are in it from the start;
 * whatever is loaded from an address joins them later (see `load.ts`).
 */

import { BUILTIN_TOOLS, RESERVED_KEYS } from './builtins';
import { PluginRegistry } from './registry';

export const plugins = new PluginRegistry(RESERVED_KEYS);

for (const builtin of BUILTIN_TOOLS) {
  plugins.register(builtin, { builtin: true });
}

export { PENCIL } from './builtins';
export { PLUGIN_API } from './contract';
export type { Plugin, PluginBrush, PluginHost, PluginPoint, PluginPrimitive, PluginStroke, PluginTool } from './contract';
export type { PluginFailure, RegisteredTool } from './registry';
