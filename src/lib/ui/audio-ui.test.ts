import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

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
  });

  it('the key does not promise a dialog the plate is not', () => {
    // The plate is a group: no focus of its own, no Esc. `haspopup="dialog"`
    // told a screen reader a window was coming.
    const key = editorUi.slice(editorUi.indexOf("id === 'audio'"), editorUi.indexOf("id === 'export'"));
    expect(key).toContain('aria-expanded={audioOpen}');
    expect(key).not.toContain('aria-haspopup');
  });

  it('the plate stands over the bar that scrolls, not inside its clip', () => {
    // Absolute inside the scrolling toolbar, the plate was cut off whole on a
    // wide screen. Fixed, placed from its key, it is clipped by nothing.
    const plate = panel.slice(panel.indexOf('  .audio-plate {'));
    expect(plate.slice(0, plate.indexOf('}'))).toContain('position: fixed');
    expect(panel).toContain('anchor.getBoundingClientRect()');
    expect(editorUi).toContain('anchor={audioKey}');
  });

  it('lies in the paper tone, apart from the white sheet it stands over', () => {
    const plate = panel.slice(panel.indexOf('  .audio-plate {'));
    expect(plate.slice(0, plate.indexOf('}'))).toContain('background: var(--paper)');
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

describe('eighth audit: the soundtrack plate', () => {
  it('the wide key grows along the row but keeps its height in a column', () => {
    // `flex: 1` is a zero basis: in the empty plate's column «Выбрать файл…»
    // lost its 44 px and stood 27 px tall.
    const wide = panel.match(/\.wide \{[^}]*\}/)?.[0] ?? '';
    expect(wide).not.toMatch(/flex:\s*1\b/);
    expect(wide).toContain('flex-grow: 1');
  });

  it('is placed again when the window changes, and lets go of it on a phone', () => {
    // A left from the desktop stayed inline after the window narrowed and
    // squeezed the phone drawer into a 90 px column at the right edge.
    expect(panel).toMatch(/<svelte:window[^>]*onresize=/);
    expect(panel).toMatch(/matches\)\s*\{\s*at = undefined/);
    // The strip grows by the wave's lane when a track lands, and the key moves.
    expect(panel).toMatch(/void editor\.audio\.hasTrack/);
  });

  it('hands focus back to its key when it closes', () => {
    // WCAG 2.4.3: the × and the bin vanish with the plate, and focus fell to <body>.
    expect(panel).toContain('anchor?.focus()');
    expect(panel).not.toMatch(/onclick=\{onClose\}/);
  });
});

describe('ninth audit: the soundtrack', () => {
  it('a draft whose track fails to load does not keep the last draft\'s track', () => {
    // Opening draft B after draft A: B's track failed to decode (or came back
    // short), A's stayed attached, played under B and had its credits written
    // into B. The draft's own file is kept — named, not decoded — so nothing
    // on disk is lost and nothing from another draft is played.
    const restore = state.slice(state.indexOf('async restore('), state.indexOf('#adoptUnread(blob'));
    expect(restore).toContain('this.#adoptUnread(');
    expect(state).toMatch(/#adoptUnread\([^)]*\)[^{]*\{[\s\S]*?this\.envelope = new Float32Array\(0\);[\s\S]*?this\.duration = 0;/);
  });

  it('a replaced track\'s element lets go of its file and says nothing more', () => {
    // Revoking the URL under an element still fetching it fires its onerror,
    // which then blamed the *new* track: «Этот звук браузер не проигрывает».
    const revoke = state.slice(state.indexOf('#revoke(): void'));
    expect(revoke).toMatch(/onerror = null/);
    expect(revoke).toContain("removeAttribute('src')");
  });

  it('the envelope is decoded at a low rate, not at the device rate', () => {
    // A five-minute song at 48 kHz stereo is ~115 MB of floats for a picture
    // that keeps 200 levels a second; at 8 kHz it is a sixth of that on the
    // 2 GB phone the product is built for.
    expect(state).toContain('new OfflineAudioContext(1, 1, DECODE_RATE)');
    expect(state).not.toContain('new AudioContext()');
  });

  it('only the last file picked is kept, however the decodes finish', () => {
    expect(state).toMatch(/const ticket = \+\+this\.#ticket;/);
    expect(state).toMatch(/ticket !== this\.#ticket/);
  });

  it('says it is reading a file and that it took it, in a region that is already there', () => {
    expect(state).toContain('loading = $state(false)');
    // Mounted with the plate, so the first message in it is heard at all.
    expect(panel).toMatch(/<p class="sr-only" role="status">\s*\{#if editor\.audio\.loading\}/);
    expect(panel).toContain("t('audio.reading')");
    expect(panel).toContain("t('audio.loaded'");
  });

  it('the picked file\'s key vanishes with the empty plate, so focus moves to its replacement', () => {
    expect(panel).toContain('replaceKey?.focus()');
  });

  it('a refused play is forgotten once a play goes through', () => {
    expect(state).toMatch(/\.then\(\s*\(\) => \{[\s\S]*?t\('audio\.blocked'\)/);
  });

  it('talks to the person as «ты», like the rest of the studio', () => {
    expect(t('audio.undecodable')).not.toMatch(/попробуйте|Попробуйте/);
  });
});

describe('ninth audit: the plate fits the window', () => {
  it('scrolls inside the window rather than growing off its top', () => {
    // 320 px at 200 % text: 1210 px of plate pinned to the bottom of a 640 px
    // window, its × and both fields above the top edge and out of reach.
    const plate = panel.slice(panel.indexOf('  .audio-plate {'));
    const rule = plate.slice(0, plate.indexOf('}'));
    expect(rule).toContain('max-height: 100dvh');
    expect(rule).toContain('overflow-y: auto');
  });

  it('beside its key, takes the side with more room and stays inside it', () => {
    expect(panel).toContain('style:max-height=');
    expect(panel).toMatch(/above >= below/);
  });
});

describe('tenth audit: the soundtrack', () => {
  it('the credit fields stop where the server stops', () => {
    // Past 120 characters the publication came out silent, and nobody said so.
    const fields = panel.match(/<input bind:value=\{editor\.audio\.(name|author)\}[^>]*>/g) ?? [];
    expect(fields.length).toBe(2);
    for (const field of fields) expect(field).toContain('maxlength={AUDIO_MAX_CREDIT}');
  });

  it('a load hands its credits through trackCredits, and remembers which artist came from tags', () => {
    expect(state).toContain('trackCredits(tags, name, author, this.#taggedArtist)');
    expect(state).toMatch(/clear\(\): void \{[\s\S]*?this\.#taggedArtist = '';/);
  });

  it('the switch is named by its label and described by the hint, not named by both', () => {
    // «Привязать к кадрам мультик крутится сам по себе…» was the switch's name.
    const toggle = panel.match(/<input\s+type="checkbox"\s+role="switch"[^>]*>/)?.[0] ?? '';
    expect(toggle).toContain('aria-labelledby=');
    expect(toggle).toContain('aria-describedby=');
  });
});
