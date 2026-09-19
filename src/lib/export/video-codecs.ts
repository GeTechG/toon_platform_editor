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
  /** Codec strings to try, best first: `[WebCodecs config, mediabunny name]`. */
  video: readonly (readonly [string, VideoCodecName])[];
  audio: readonly [string, AudioCodecName];
}

const CANDIDATES: readonly Candidate[] = [
  {
    extension: 'mp4',
    label: 'MP4 (H.264)',
    video: [['avc1.42001f', 'avc']],
    audio: ['mp4a.40.2', 'aac'],
  },
  {
    extension: 'webm',
    label: 'WebM',
    video: [
      ['vp09.00.10.08', 'vp9'],
      ['vp8', 'vp8'],
    ],
    audio: ['opus', 'opus'],
  },
];

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
    for (const [config, videoCodec] of candidate.video) {
      if (await probeVideo({ codec: config })) {
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
