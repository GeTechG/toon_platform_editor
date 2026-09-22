import { describe, expect, it } from 'bun:test';
import { createErrorLog } from './error-log';

// Every EditorState used to hang two listeners on the window and wrap
// console.error once more, and nothing took them off. The site mounts the
// editor on client navigation, so publish → back → edit kept each old editor —
// its document, its undo — reachable from the window for the life of the tab,
// and console.error grew one wrapper deeper each visit.

function fakeWindow() {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  return {
    listeners,
    addEventListener(type: string, fn: (e: Event) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type: string, event: object) {
      for (const fn of listeners.get(type) ?? []) fn(event as Event);
    },
  };
}

describe('the session error log', () => {
  it('watching twice installs one listener and one console wrapper', () => {
    const win = fakeWindow();
    const printed: unknown[][] = [];
    const con = { error: (...args: unknown[]) => printed.push(args) };
    const log = createErrorLog();
    log.watch(win, con);
    log.watch(win, con);
    expect(win.listeners.get('error')?.length).toBe(1);
    expect(win.listeners.get('unhandledrejection')?.length).toBe(1);
    con.error('boom');
    expect(log.lines.length).toBe(1);
    expect(printed).toEqual([['boom']]);
  });

  it('notes window errors and rejected promises', () => {
    const win = fakeWindow();
    const log = createErrorLog();
    log.watch(win, { error: () => {} });
    win.fire('error', { error: new Error('thrown'), message: 'thrown' });
    win.fire('unhandledrejection', { reason: 'lost' });
    expect(log.lines[0]).toContain('thrown');
    expect(log.lines[1]).toContain('lost');
  });

  it('keeps the last 200 lines', () => {
    const win = fakeWindow();
    const con = { error: (..._: unknown[]) => {} };
    const log = createErrorLog();
    log.watch(win, con);
    for (let i = 0; i < 205; i++) con.error(`e${i}`);
    expect(log.lines.length).toBe(200);
    expect(log.lines[0]).toContain('e5');
  });
});

describe('the editor state does not bind itself to the window', () => {
  it('uses the one session log instead of adding listeners per instance', async () => {
    const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
    expect(state).not.toContain("window.addEventListener('error'");
    expect(state).not.toContain('console.error =');
    expect(state).toContain('sessionErrors');
  });
});
