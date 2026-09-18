import { describe, expect, it } from 'bun:test';

const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const player = await Bun.file(new URL('../player/Player.svelte', import.meta.url)).text();
const playControls = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('../audio/state.svelte.ts', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('sound never fails silently', () => {
  it('a refused play stops the player instead of looping a mute picture', () => {
    // Browsers refuse to start audio the visitor did not ask for. Playing on
    // without sound reads as "this animation has none" and hides the way in.
    expect(player).toContain('playing = false;');
  });

  it('the editor says why the sound did not start, rather than only the console', () => {
    expect(state).toContain('this.error =');
    expect(state).toMatch(/element\.onerror/);
    // A track is fetched before the first press, not on it.
    expect(state).toContain("element.preload = 'auto'");
  });

  it('an unknown duration is not a reason to stay quiet', () => {
    expect(state).toContain('this.duration > 0 && at >= this.duration');
  });

  it('the preview reads its frame off the track while it sounds', () => {
    expect(playControls).toContain('editor.audio.sounding');
    expect(playControls).toContain('frameForTime(editor.audio.currentTime');
    expect(playControls).toContain('editor.audio.stop()');
  });
});

describe('the track strip', () => {
  it('shows both lengths, so a wave shorter than the track explains itself', () => {
    expect(timeline).toContain('clock(filmSeconds)');
    expect(timeline).toContain('clock(editor.audio.duration)');
  });

  it('keeps the credits at a readable width instead of filling the panel', () => {
    // The studio panel is as wide as the window; two stretched fields there
    // were the original complaint.
    expect(timeline).toMatch(/\.meta \{[^}]*width: 9rem/);
    expect(timeline).not.toMatch(/\.meta \{[^}]*flex: 1 1/);
  });

  it('travels with the frame strip as one flex item in the bar layout', () => {
    expect(timeline).toContain('class="bar-layout"');
  });

  it('draws a lane even where the track is silent', () => {
    expect(timeline).toContain('Math.max(6,');
  });
});

describe('the draft keeps the track without inventing sessions', () => {
  it('an untouched editor writes no record just because it has no sound', () => {
    expect(editorUi).toContain('if (!blob && draftId === null)');
  });

  it('the panel floor makes room for the strip and the lane', () => {
    expect(editorUi).toContain('PANEL_HEIGHT_AUDIO');
    expect(editorUi).toContain('editor.audio.hasTrack');
  });
});
