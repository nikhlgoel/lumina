// No Node imports: shared by the main process and the renderer.

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.opus', '.ogg', '.oga', '.wav', '.wma', '.alac', '.aiff', '.aif']);
export const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.wmv', '.ts', '.m2ts', '.flv']);
export const PLAYLIST_EXT = new Set(['.m3u', '.m3u8', '.pls', '.xspf', '.wpl', '.zpl']);

export function extensionOf(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function mediaKindOf(file: string): 'audio' | 'video' | null {
  const ext = extensionOf(file);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}
