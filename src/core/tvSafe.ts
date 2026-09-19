// What a television can actually play.
//
// A TV's USB port is a storage input: the set uses its own built-in media browser, and that browser
// decodes far less than a PC does. Hand it an HEVC 10-bit MKV with DTS audio and it says
// "unsupported file" — which is the single most common reason a drive that works on a laptop fails
// on a TV.
//
// These rules were previously inline in src/main/media/probe.ts, used only to label downloads. They
// live here now so the USB export can apply the same judgement, and so they can be tested properly
// instead of being trusted.
//
// The profile is deliberately conservative — H.264 8-bit with AAC in MP4 is the broadest thing that
// exists. Sets from around 2010 onwards play it; newer ones play far more, but nothing is lost by
// staying inside the safe set.

export interface TvProfile {
  container: string;
  videoCodecs: string[];
  audioCodecs: string[];
  maxHeight: number;
  maxFps: number;
  /** More channels than this are downmixed; many TVs output stereo only over their own speakers. */
  maxAudioChannels: number;
}

export const TV_PROFILE: TvProfile = {
  container: 'mp4',
  videoCodecs: ['h264'],
  // AC-3 is included because virtually every TV decodes it; DTS and friends are not.
  audioCodecs: ['aac', 'mp3', 'ac3', 'eac3'],
  maxHeight: 1080,
  maxFps: 60,
  maxAudioChannels: 6,
};

/** Just enough about a file to judge it. `ProbeResult` maps onto this. */
export interface MediaFacts {
  container: string;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    pixFmt: string | null;
    hdr: boolean;
  } | null;
  audio: {
    codec: string;
    channels: number | null;
    bitrateKbps: number | null;
    sampleRate: number | null;
  } | null;
}

/**
 * A 10-bit or wider pixel format. TVs that decode H.264 happily still choke on 10-bit.
 *
 * The naming is easy to get wrong, and a loose "contains 10/12/16" test does: **nv12 is 8-bit** —
 * the 12 is chroma subsampling, not depth — while **p010le is 10-bit** despite the digits reading
 * as "010". So match only the two real conventions: a depth after the plane marker
 * (`yuv420p10le`, `gbrp16le`) and the Microsoft-style semi-planar names (`p010le`, `p016le`).
 */
export function isHighBitDepth(pixFmt: string | null): boolean {
  if (!pixFmt) return false;
  const f = pixFmt.toLowerCase();
  return /p(10|12|14|16)(le|be)?$/.test(f) || /^p0(10|12|16)(le|be)?$/.test(f);
}

/**
 * Every reason this file may not play on a TV, in plain words.
 *
 * Returning reasons rather than a bare boolean matters: the user is about to spend minutes
 * converting, and "HEVC video, 10-bit" earns that wait in a way "not compatible" does not.
 */
export function tvSafeReasons(facts: MediaFacts, profile: TvProfile = TV_PROFILE): string[] {
  const reasons: string[] = [];
  const container = (facts.container ?? '').toLowerCase();

  if (facts.video) {
    const v = facts.video;
    if (!profile.videoCodecs.includes(v.codec.toLowerCase())) reasons.push(`${v.codec.toUpperCase()} video`);
    if (v.height > profile.maxHeight) reasons.push(`${v.height}p`);
    // Only complain about frame rate when it is genuinely known; probes report 0 for odd files.
    if (v.fps > profile.maxFps + 0.5) reasons.push(`${Math.round(v.fps)} fps`);
    if (v.hdr) reasons.push('HDR');
    else if (isHighBitDepth(v.pixFmt)) reasons.push('10-bit');
    // Containers only matter when there is video; a bare .flac is judged on its codec alone.
    if (container && !container.includes(profile.container)) reasons.push('not MP4');
  }

  if (facts.audio && !profile.audioCodecs.includes(facts.audio.codec.toLowerCase())) {
    reasons.push(`${facts.audio.codec.toUpperCase()} audio`);
  }

  return reasons;
}

export const isTvSafe = (facts: MediaFacts, profile: TvProfile = TV_PROFILE): boolean =>
  tvSafeReasons(facts, profile).length === 0;

/** A short human description of what the file is, with no judgement attached. */
export function describeMedia(facts: MediaFacts): string {
  if (facts.video) {
    const v = facts.video;
    const fps = Number.isFinite(v.fps) && v.fps > 0 ? Math.round(v.fps) : null;
    return [
      `${v.codec.toUpperCase()} ${v.height}p${fps ?? ''}`,
      facts.audio ? facts.audio.codec.toUpperCase() : null,
    ].filter(Boolean).join(' · ');
  }
  if (facts.audio) {
    const a = facts.audio;
    const lossless = ['flac', 'alac', 'pcm_s16le', 'pcm_s24le'].includes(a.codec);
    return [
      a.codec.toUpperCase(),
      lossless ? 'lossless' : a.bitrateKbps ? `${a.bitrateKbps} kbps` : null,
      a.sampleRate ? `${(a.sampleRate / 1000).toFixed(1)} kHz` : null,
    ].filter(Boolean).join(' · ');
  }
  return 'Unknown';
}

/** The one-line verdict the UI shows. */
export function tvSummary(facts: MediaFacts, profile: TvProfile = TV_PROFILE): string {
  const reasons = tvSafeReasons(facts, profile);
  const base = describeMedia(facts);
  return reasons.length === 0 ? base : `${base} — needs conversion for TVs (${reasons.join(', ')})`;
}

/**
 * What a converted copy should be called.
 *
 * The extension becomes .mp4 because that is the container TVs agree on; the stem is kept so the
 * drive still reads as the user's own library rather than a pile of hashes.
 */
export function tvSafeName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${stem}.mp4`;
}

/**
 * Converting is far slower than copying, so the progress bar has to weight it — otherwise a
 * transfer sits at "3 of 40" for ten minutes and looks hung.
 *
 * The multiplier is a rough, honest guess (a conversion costs roughly an order of magnitude more
 * than a copy of the same bytes); it is used only to make the bar move sensibly, never reported as
 * a time estimate.
 */
export const CONVERT_COST = 10;

export function weightedBytes(sizeBytes: number, needsConversion: boolean): number {
  return needsConversion ? sizeBytes * CONVERT_COST : sizeBytes;
}
