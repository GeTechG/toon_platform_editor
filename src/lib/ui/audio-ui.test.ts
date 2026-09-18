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

describe('playback cannot be bricked', () => {
  it('a throw inside one frame does not end the loop', () => {
    // It used to: the frames froze, the key still read "stop", and only a
    // reload brought the preview back.
    expect(playControls).toMatch(/try \{[\s\S]*rafId = requestAnimationFrame\(tick\)/);
    expect(playControls).toContain("console.warn('playback tick failed:'");
  });

  it('a set playing flag with no loop behind it counts as stopped', () => {
    // `editor.playing` outlives this component; a remount mid-preview leaves
    // the flag set and nothing running, and the key has to start it again.
    expect(playControls).toContain('editor.playing && player !== null');
  });

  it('a track that decodes mid-preview joins it instead of staying silent', () => {
    expect(playControls).toContain('!editor.audio.hasTrack || !editor.playing');
    expect(playControls).toContain('editor.audio.playFrom(untrack(');
  });

  it('restoring credits writes nothing either', () => {
    expect(editorUi).toContain('storedCredits');
    expect(editorUi).toContain('credits === storedCredits');
  });

  it('a restored track is not written back over itself', () => {
    // Megabytes of IndexedDB traffic a second after the draft opens, on the
    // very Blob the playing element is reading through an object URL.
    expect(editorUi).toContain('storedBlob');
    expect(editorUi).toContain('blob === storedBlob');
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

describe('the draft keeps the track whole', () => {
  it('a credit edit writes the credits, not the file again', () => {
    // Reading name/author in the effect that writes the blob put megabytes
    // into IndexedDB per keystroke, and raced the autosave doing the same.
    expect(editorUi).toContain('setDraftCredits(');
    expect(editorUi).toMatch(/const blob = editor\.audio\.blob;/);
  });

  it('a track that came back short is reported, not played as a stub', () => {
    expect(state).toContain('track.bytes !== track.blob.size');
    expect(state).toContain('повреждён');
  });
});

describe('the draft keeps the track without inventing sessions', () => {
  it('an untouched editor writes no record just because it has no sound', () => {
    expect(editorUi).toContain('blob === storedBlob');
  });

  it('the panel floor grows only when there is a track', () => {
    expect(editorUi).toContain('editor.audio.hasTrack');
  });
});
