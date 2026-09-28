/**
 * Which container and codecs this browser will actually encode into, asked of
 * WebCodecs itself. Pure: the probes are injected, so the choice is testable
 * without a browser and without the muxer.
 *
 * mp4 leads — it plays everywhere a phone does. A browser that encodes H.264
 * but has no AAC encoder (Chrome on Linux) would write an mp4 with Opus in
 * it, which a phone will not play, so a sounded export drops to WebM instead.
 */

export const VIDEO_BITRATE = 5_000_000;
export const AUDIO_BITRATE = 128_000;

/** Codec names as mediabunny knows them. */
export type VideoCodecName = 'avc' | 'vp9' | 'vp8';
export type AudioCodecName = 'aac' | 'opus';

export interface VideoTarget {
  extension: 'mp4' | 'webm';
  /** What the export sheet calls it. */
  label: string;
  videoCodec: VideoCodecName;
  /** Left out for a silent export. */
  audioCodec?: AudioCodecName;
}

interface Candidate {
  extension: 'mp4' | 'webm';
  label: string;
  /** Codecs to try, best first, as mediabunny names them. */
  video: readonly VideoCodecName[];
  audio: readonly [string, AudioCodecName];
}

const CANDIDATES: readonly Candidate[] = [
  {
    extension: 'mp4',
    label: 'MP4 (H.264)',
    video: ['avc'],
    audio: ['mp4a.40.2', 'aac'],
  },
  {
    extension: 'webm',
    label: 'WebM',
    video: ['vp9', 'vp8'],
    audio: ['opus', 'opus'],
  },
];

/** `[max macroblocks, max bitrate, level]` — AVC levels 2 and up (below them no bitrate of ours fits), as mediabunny's table has them. */
const AVC_LEVELS: readonly (readonly [number, number, number])[] = [
  [396, 2_000_000, 0x14],
  [792, 4_000_000, 0x15],
  [1620, 4_000_000, 0x16],
  [1620, 10_000_000, 0x1e],
  [3600, 14_000_000, 0x1f],
  [5120, 20_000_000, 0x20],
  [8192, 20_000_000, 0x28],
  [8192, 50_000_000, 0x29],
  [8704, 50_000_000, 0x2a],
  [22080, 135_000_000, 0x32],
  [36864, 240_000_000, 0x33],
  [139264, 240_000_000, 0x3c],
];

/** `[max picture size, max bitrate, level]` — VP9 levels, as mediabunny's table has them. */
const VP9_LEVELS: readonly (readonly [number, number, number])[] = [
  [36864, 200_000, 10],
  [73728, 800_000, 11],
  [122880, 1_800_000, 20],
  [245760, 3_600_000, 21],
  [552960, 7_200_000, 30],
  [983040, 12_000_000, 31],
  [2228224, 18_000_000, 40],
  [2228224, 30_000_000, 41],
  [8912896, 60_000_000, 50],
  [35651584, 180_000_000, 60],
];

const hex = (n: number) => n.toString(16).padStart(2, '0');

/**
 * The codec string the encoder will actually be configured with — the one
 * mediabunny builds for this size and bitrate: High profile at the level the
 * frame needs. The probe used to ask for Baseline 3.1 whatever the size, and
 * Chrome refuses 1920 and 2560 at that level: mp4 went missing for them and
 * the sheet said «этот браузер не кодирует MP4».
 */
export function codecString(codec: VideoCodecName, width: number, height: number, bitrate = VIDEO_BITRATE): string {
  if (codec === 'avc') {
    const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
    const level = (AVC_LEVELS.find(([mbs, rate]) => blocks <= mbs && bitrate <= rate) ?? AVC_LEVELS[AVC_LEVELS.length - 1])[2];
    return `avc1.6400${hex(level)}`;
  }
  if (codec === 'vp9') {
    const picture = width * height;
    const level = (VP9_LEVELS.find(([size, rate]) => picture <= size && bitrate <= rate) ?? VP9_LEVELS[VP9_LEVELS.length - 1])[2];
    return `vp09.00.${String(level).padStart(2, '0')}.08`;
  }
  return 'vp8';
}

export interface SelectVideoTargetOptions {
  hasAudio: boolean;
  width: number;
  height: number;
  probeVideo?: (config: { codec: string }) => Promise<boolean>;
  probeAudio?: (config: { codec: string }) => Promise<boolean>;
}

const encoderSupports = async (
  Encoder: { isConfigSupported(config: never): Promise<{ supported?: boolean }> } | undefined,
  config: object,
): Promise<boolean> => {
  if (!Encoder) {
    return false;
  }
  try {
    return (await Encoder.isConfigSupported(config as never)).supported === true;
  } catch {
    return false;
  }
};

/** The best container this browser can encode into, or `null` if there is none. */
export async function selectVideoTarget({
  hasAudio,
  width,
  height,
  probeVideo = (config) =>
    encoderSupports(typeof VideoEncoder === 'undefined' ? undefined : VideoEncoder, {
      ...config,
      width,
      height,
      bitrate: VIDEO_BITRATE,
    }),
  probeAudio = (config) =>
    encoderSupports(typeof AudioEncoder === 'undefined' ? undefined : AudioEncoder, {
      ...config,
      sampleRate: 48000,
      numberOfChannels: 2,
    }),
}: SelectVideoTargetOptions): Promise<VideoTarget | null> {
  for (const candidate of CANDIDATES) {
    if (hasAudio && !(await probeAudio({ codec: candidate.audio[0] }))) {
      continue;
    }
    for (const videoCodec of candidate.video) {
      if (await probeVideo({ codec: codecString(videoCodec, width, height) })) {
        return {
          extension: candidate.extension,
          label: candidate.label,
          videoCodec,
          ...(hasAudio ? { audioCodec: candidate.audio[1] } : {}),
        };
      }
    }
  }
  return null;
}
