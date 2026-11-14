import { describe, expect, it } from 'bun:test';
import { onEditorCommand, reportCommand } from './command-trail';

describe('the studio tells what it was asked to do', () => {
  it('hands every command to whoever listens, by name and in order', () => {
    const heard: string[] = [];
    const stop = onEditorCommand((name) => heard.push(name));
    reportCommand('tool:brush');
    reportCommand('frame-add');
    reportCommand('paste');
    stop();
    expect(heard).toEqual(['tool:brush', 'frame-add', 'paste']);
  });

  it('stops telling once the listener has stopped', () => {
    const heard: string[] = [];
    const stop = onEditorCommand((name) => heard.push(name));
    stop();
    reportCommand('undo');
    expect(heard).toEqual([]);
  });

  it('carries on with the command when a listener fails', () => {
    const heard: string[] = [];
    const stopBroken = onEditorCommand(() => {
      throw new Error('listener broke');
    });
    const stop = onEditorCommand((name) => heard.push(name));
    expect(() => reportCommand('redo')).not.toThrow();
    stopBroken();
    stop();
    expect(heard).toEqual(['redo']);
  });
});
