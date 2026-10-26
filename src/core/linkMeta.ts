import type { MediaInfo } from '../shared/types';
import { formatBytes, formatDuration, resolutionLabel } from './format';

/**
 * The one muted line under a link's title: "site · 0:10 · MP4 · up to 1080p · about 1.0 MB".
 * Each part appears only when the site actually told Lumina; nothing is guessed to fill the line.
 */
export function linkMetaLine(info: MediaInfo, itemCount = 1): string {
  const parts: string[] = [info.site];
  if (info.sourceKind === 'playlist') {
    parts.push(`${itemCount} of ${info.entries.length} items`);
    return parts.join(' · ');
  }
  if (info.durationSec) parts.push(formatDuration(info.durationSec));

  const video = info.videoStreams[0];
  const audio = info.audioStreams[0];
  if (info.sourceKind === 'torrent') {
    const files = info.torrent?.files.length ?? 0;
    if (files) parts.push(`${files} file${files === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }
  if (info.sourceKind === 'direct') {
    const name = info.direct?.filename ?? '';
    if (name.includes('.')) parts.push((name.split('.').pop() ?? '').toUpperCase());
    if (info.direct?.sizeBytes) parts.push(formatBytes(info.direct.sizeBytes));
    return parts.join(' · ');
  }
  if (video) {
    parts.push(video.ext.toUpperCase());
    const tallest = Math.max(...info.videoStreams.map((v) => v.height));
    if (tallest > 0) parts.push(`up to ${resolutionLabel(tallest)}`);
  } else if (audio) {
    parts.push(audio.codec === 'other' ? audio.ext.toUpperCase() : audio.codec.toUpperCase());
  }

  const size = approximateSize(info);
  if (size) parts.push(`about ${formatBytes(size)}`);
  return parts.join(' · ');
}

/** The best video plus the best audio, when the site gave their sizes. */
function approximateSize(info: MediaInfo): number | null {
  const video = info.videoStreams[0]?.sizeBytes ?? 0;
  const audio = info.audioStreams[0]?.sizeBytes ?? 0;
  return video + audio > 0 ? video + audio : null;
}

/**
 * Whether Play can be offered for a read link. A torrent or a file host's download page has nothing to stream until it is
 * downloaded; everything else can start from the link.
 */
export function canPlayLink(info: Pick<MediaInfo, 'sourceKind' | 'direct'>): boolean {
  if (info.sourceKind === 'torrent') return false;
  if (info.sourceKind === 'direct' && info.direct?.hosted) return false;
  return true;
}
