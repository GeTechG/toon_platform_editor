import { describe, expect, it } from 'bun:test';

const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const player = await Bun.file(new URL('../player/Player.svelte', import.meta.url)).text();
const playControls = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('../audio/state.svelte.ts', import.meta.url)).text();
const panel = await Bun.file(new URL('./AudioPanel.svelte', import.meta.url)).text();
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

  it('the sound loops with the frames, so a short track is not silence later', () => {
    expect(state).toContain('element.loop = true');
  });
});

describe('the timeline carries the wave and nothing else', () => {
  it('no file picker, no credits and no bin under the frames', () => {
    // A row of fields under the strip was in the way of the strip.
    expect(timeline).not.toContain('type="file"');
    expect(timeline).not.toContain('Название трека');
    expect(timeline).not.toContain('Убрать звук');
  });

  it('draws a lane even where the track is silent', () => {
    expect(timeline).toContain('Math.max(6,');
  });

  it('the panel floor only has to make room for that lane', () => {
    expect(editorUi).toContain('PANEL_HEIGHT_AUDIO');
  });
});

describe('the soundtrack panel', () => {
  it('opens from its own key rather than sitting on the timeline', () => {
    expect(editorUi).toContain('<AudioPanel');
    expect(editorUi).toContain('audioOpen');
    expect(editorUi).toContain("aria-haspopup=\"dialog\"");
  });

  it('holds the file, the credits and the bin', () => {
    expect(panel).toContain('type="file"');
    expect(panel).toContain('editor.audio.name');
    expect(panel).toContain('editor.audio.author');
    expect(panel).toContain('editor.audio.clear()');
  });

  it('names both lengths, so a wave shorter than the track explains itself', () => {
    expect(panel).toContain('clock(filmSeconds)');
    expect(panel).toContain('clock(editor.audio.duration)');
    expect(panel).toContain('trackOutruns');
  });
});

describe('the draft keeps the track without inventing sessions', () => {
  it('an untouched editor writes no record just because it has no sound', () => {
    expect(editorUi).toContain('if (!blob && draftId === null)');
  });

  it('the panel floor grows only when there is a track', () => {
    expect(editorUi).toContain('editor.audio.hasTrack');
  });
});
