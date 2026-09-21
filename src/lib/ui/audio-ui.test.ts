import { describe, expect, it } from 'bun:test';

const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const player = await Bun.file(new URL('../player/Player.svelte', import.meta.url)).text();
const playControls = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('../audio/state.svelte.ts', import.meta.url)).text();
const track = await Bun.file(new URL('../audio/track.ts', import.meta.url)).text();
const sheet = await Bun.file(new URL('./ExportSheet.svelte', import.meta.url)).text();
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
    // Silence only past a *known* end; an undecoded length is not one.
    expect(track).toContain('duration > 0 && at >= duration ? null : at');
  });

  it('the preview starts and stops the sound with the frames', () => {
    expect(playControls).toContain('editor.audio.playFrom(');
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

describe('the synchronisation flag', () => {
  it('decides whether the track drives the frames', () => {
    expect(playControls).toContain('editor.audio.sync && editor.audio.hasTrack');
    expect(player).toContain('audioSync && sound');
  });

  it('untied, the track starts at its own beginning rather than at the frame', () => {
    expect(state).toContain('this.sync ? trackTimeFor(frame, fps, this.duration) : 0');
  });

  it('a freshly attached track is untied, so a song plays under the frames', () => {
    // Tied is the reference's behaviour but a trap as a default: the loop is
    // frames/fps long, and on a one-frame document that rewinds the track
    // twelve times a second — the preview looks right and sounds like nothing.
    expect(state).toContain('sync = $state(false)');
  });

  it('a track from before the flag reads as tied', () => {
    expect(state).toContain('track.sync ?? true');
  });

  it('is offered in the panel and travels with a publish', () => {
    expect(panel).toContain('bind:checked={editor.audio.sync}');
    expect(editorUi).toContain('sync: editor.audio.sync');
  });

  it('tied, the track is pulled back to where the frame sits on every pass', () => {
    // One frame, one point of the track: past its end the pass is quiet, and
    // the next turn of the animation starts the track again.
    expect(playControls).toContain('editor.audio.reseekAtLoop(');
    expect(player).toContain('trackShouldRestart(sound.currentTime');
    expect(state).toContain('trackTimeFor(frame, fps, this.duration)');
  });

  it('the frames keep their own clock in both modes', () => {
    // The reference counts frames with `UpdatePlayFrame` whether the track is
    // tied or not; reading them off the track's clock is how they drift.
    expect(playControls).not.toContain('frameForTime(editor.audio.currentTime');
  });

  it('the exported file is what the preview sounds like', () => {
    // Tied: one pass of the animation with the track pinned to it. Untied:
    // the track sets the length and the animation loops under it, so a long
    // song is not cut off at half a second of video.
    expect(sheet).toContain('editor.audio.hasTrack && !editor.audio.sync ? editor.audio.duration');
    expect(sheet).toContain('trackSeconds,');
  });

  it('the player can be stepped a frame at a time, and the track follows', () => {
    expect(player).toContain('current = $bindable(0)');
    expect(player).toContain('audio.currentTime = (frame % frameCount(view))');
  });

  it('rides the light write, never the file', () => {
    expect(editorUi).toContain('setDraftCredits(draftId, name, author, sync)');
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
    expect(state).toContain("t('audio.draft_broken')");
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
