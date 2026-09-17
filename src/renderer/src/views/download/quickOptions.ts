import type { Settings } from '@shared/settings';
import type { DownloadOptions, MediaInfo } from '@shared/types';
import { defaultPresetFor, guessContentType } from '@core/presets';

/** The options a download gets when the user doesn't pick anything (batch adds, quick actions). */
export function quickOptions(info: MediaInfo, settings: Settings): DownloadOptions {
  const contentType = guessContentType(info);
  const preset = defaultPresetFor(contentType, settings.downloads.defaultPreset);
  return {
    contentType,
    format: preset.format,
    englishSubtitles: preset.format.kind === 'video' && settings.subtitles.englishByDefault,
    subtitleOutput: settings.subtitles.output,
    embedMetadata: settings.downloads.embedMetadata,
    embedLyrics: settings.downloads.embedLyrics,
    sponsorBlock: settings.downloads.sponsorBlock !== 'off',
    playlistItems: [],
  };
}
