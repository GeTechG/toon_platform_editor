/**
 * What «Справка» says, as data: sections by task, a row per action, with what
 * the hand in front of it has. The keys themselves come from the keymap; a
 * tool's row exists only where the tool is on the panel, as its key does.
 */
import { t } from '../i18n';
import { toolCommand } from './keymap';

export type ManualSectionId = 'draw' | 'colour' | 'frames' | 'edit' | 'preview' | 'sheet' | 'selection' | 'file';

export type ManualRow =
  /** An action a key runs: its keys can be changed here. */
  | { kind: 'command'; id: string; command: string; label: string }
  /** Keys that are not anyone's to change, or that belong to another action. */
  | { kind: 'fixed'; id: string; keys: string; label: string }
  /** A move of the mouse or a finger: what to do, and what it does. */
  | { kind: 'mouse' | 'gesture'; id: string; how: string; label: string };

export interface ManualSection {
  id: ManualSectionId;
  rows: readonly ManualRow[];
}

export interface ManualContext {
  /** `both` is fingers first with a mouse or a keyboard somewhere by them. */
  input: 'cursor' | 'finger' | 'both';
  /** The tools on the panel now, in their order. */
  tools: readonly { id: string; label: string }[];
  quickPalette: boolean;
  hasProjectFile: boolean;
  fullscreen: boolean;
  /** The tool in hand opens its box on a second press (panels.ts). */
  toolOpensBrush: boolean;
  /** The keys a command answers to now, as written on a cap. */
  keysOf(command: string): readonly string[];
}

/** Tools that belong to another section than drawing. */
const ELSEWHERE = new Set(['pipette', 'drag', 'lasso', 'loop']);

export function manualSections(ctx: ManualContext): ManualSection[] {
  const has = (tool: string): boolean => ctx.tools.some((one) => one.id === tool);
  const toolLabel = (tool: string): string => ctx.tools.find((one) => one.id === tool)?.label ?? '';
  const command = (id: string, key: string): ManualRow => ({ kind: 'command', id, command: id, label: t(`key.${key}`) });
  const tool = (id: string): ManualRow => ({ kind: 'command', id: toolCommand(id), command: toolCommand(id), label: toolLabel(id) });
  const mouse = (id: string): ManualRow => ({ kind: 'mouse', id: `mouse.${id}`, how: t(`mouse.${id}`), label: t(`mouse_does.${id}`) });
  const gesture = (id: string): ManualRow => ({ kind: 'gesture', id: `gesture.${id}`, how: t(`gesture.${id}`), label: t(`gesture_does.${id}`) });
  const fixed = (id: string, keys: string): ManualRow => ({ kind: 'fixed', id, keys, label: t(`key.${id}`) });
  const caps = (id: string): string => ctx.keysOf(id)[0] ?? '—';
  const nudge = `${caps('frame-prev')} ${caps('frame-next')} ${caps('layer-up')} ${caps('layer-down')}`;
  const size = `${caps('brush-bigger')} / ${caps('brush-smaller')}`;

  const again = ctx.toolOpensBrush ? { mouse: [mouse('tool_again')], gesture: [gesture('tool_again')] } : { mouse: [], gesture: [] };

  const table: {
    id: ManualSectionId;
    keys: ManualRow[];
    mouse?: ManualRow[];
    gesture?: ManualRow[];
  }[] = [
    {
      id: 'draw',
      keys: [
        ...ctx.tools.filter((one) => !ELSEWHERE.has(one.id)).map((one) => tool(one.id)),
        command('brush-bigger', 'brush_bigger'),
        command('brush-smaller', 'brush_smaller'),
      ],
      mouse: [...again.mouse, mouse('shift_drag')],
      gesture: again.gesture,
    },
    {
      id: 'colour',
      keys: [
        { kind: 'command', id: toolCommand('pipette'), command: toolCommand('pipette'), label: t('key.pipette') },
        fixed('pick_fill', 'Shift+Enter'),
        command('swap', 'swap'),
        ...(ctx.quickPalette ? [command('merge', 'palette')] : []),
      ],
      gesture: [gesture('hold_sheet')],
    },
    {
      id: 'frames',
      keys: [
        command('frame-prev', 'frame_prev'),
        command('frame-next', 'frame_next'),
        command('frame-first', 'frame_first'),
        command('frame-last', 'frame_last'),
        command('add-frame', 'add_frame'),
        command('add-frame-before', 'add_frame_before'),
        command('duplicate-frame', 'duplicate_frame'),
        command('delete-frame', 'delete_frame'),
        command('layer-up', 'layer_up'),
        command('layer-down', 'layer_down'),
        command('add-layer', 'add_layer'),
        command('add-layer-before', 'add_layer_before'),
        command('delete-layer', 'delete_layer'),
        command('extend-left', 'extend_left'),
        command('extend-right', 'extend_right'),
        command('extend-up', 'extend_up'),
        command('extend-down', 'extend_down'),
      ],
      mouse: [mouse('frame_menu'), mouse('layer_name')],
      gesture: [gesture('hold_frame'), gesture('hold_layer')],
    },
    {
      id: 'edit',
      keys: [
        command('undo', 'undo'),
        command('redo', 'redo'),
        command('copy', 'copy'),
        command('cut', 'cut'),
        command('paste', 'paste'),
        ...(ctx.quickPalette ? [] : [command('merge', 'merge')]),
        command('mirror-h', 'mirror_h'),
        command('mirror-v', 'mirror_v'),
      ],
    },
    {
      id: 'preview',
      keys: [command('play', 'play'), command('play-from-active', 'play_from_active'), command('onion', 'onion')],
    },
    {
      id: 'sheet',
      keys: [
        ...(has('drag') ? [tool('drag')] : []),
        { kind: 'command', id: 'pan-hold', command: 'pan-hold', label: t('key.pan_hold') },
        command('zoom-in', 'zoom_in'),
        command('zoom-out', 'zoom_out'),
        command('turn-left', 'turn_left'),
        command('turn-right', 'turn_right'),
        command('pan-left', 'pan_left'),
        command('pan-right', 'pan_right'),
        command('pan-up', 'pan_up'),
        command('pan-down', 'pan_down'),
        ...(ctx.fullscreen ? [command('fullscreen', 'fullscreen')] : []),
        ...(has('drag') ? [fixed('hand_zoom', size), fixed('hand_pan', nudge), { kind: 'fixed', id: 'turn_drag', keys: t('key.turn_drag_keys'), label: t('key.turn_drag') } as ManualRow] : []),
      ],
      mouse: [mouse('middle'), mouse('wheel'), mouse('trackpad')],
      gesture: [gesture('two_fingers')],
    },
    {
      id: 'selection',
      keys: has('lasso') || has('loop')
        ? [
            ...(has('lasso') ? [tool('lasso')] : []),
            ...(has('loop') ? [tool('loop')] : []),
            ...(has('lasso')
              ? [
                  command('transform-turn-left', 'transform_turn_left'),
                  command('transform-turn-right', 'transform_turn_right'),
                  fixed('transform_size', size),
                  fixed('transform_move', nudge),
                  fixed('transform_apply', 'Enter'),
                  fixed('transform_cancel', 'Esc'),
                ]
              : []),
          ]
        : [],
    },
    {
      id: 'file',
      keys: [command('save', 'save'), command('export', ctx.hasProjectFile ? 'download_project' : 'export'), command('error-log', 'error_log')],
    },
  ];

  return table
    .map(({ id, keys, mouse: moves = [], gesture: touches = [] }): ManualSection => ({
      id,
      rows:
        ctx.input === 'finger' ? touches
        : ctx.input === 'both' ? [...touches, ...keys]
        : [...keys, ...moves],
    }))
    .filter((one) => one.rows.length > 0);
}

const fold = (text: string): string => text.toLowerCase().replace(/\u0451/g, '\u0435').replace(/\s+/g, '');

/** The sections with only what matches: the words, the move, or the keys. */
export function searchManual(
  sections: readonly ManualSection[],
  query: string,
  keysOf: (command: string) => readonly string[],
): readonly ManualSection[] {
  const wanted = fold(query);
  if (wanted === '') {
    return sections;
  }
  const said = (row: ManualRow): string =>
    row.kind === 'command' ? `${row.label} ${keysOf(row.command).join(' ')}`
    : row.kind === 'fixed' ? `${row.label} ${row.keys}`
    : `${row.how} ${row.label}`;
  return sections
    .map((one) => ({ id: one.id, rows: one.rows.filter((row) => fold(said(row)).includes(wanted)) }))
    .filter((one) => one.rows.length > 0);
}
