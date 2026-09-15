import React from 'react';
import { 
  Film, 
  Music, 
  Subtitles, 
  Check, 
  Download, 
  Clock, 
  User, 
  Eye, 
  X 
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const MediaInspector: React.FC = () => {
  const {
    inspectedMedia,
    downloadMode,
    setDownloadMode,
    selectedFormat,
    setSelectedFormat,
    selectedAudioFormat,
    setSelectedAudioFormat,
    includeSubtitles,
    setIncludeSubtitles,
    selectedSubtitleLang,
    setSelectedSubtitleLang,
    embedSubtitles,
    setEmbedSubtitles,
    startDownload,
    clearInspectedMedia
  } = useLuminaStore();

  if (!inspectedMedia) return null;

  return (
    <div className="w-full p-5 rounded-3xl glass-panel border border-white/[0.1] shadow-2xl shadow-black/40 space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Top Header: Title, Thumbnail, Creator */}
      <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
        <div className="flex gap-3.5 items-start">
          <div className="relative w-36 sm:w-44 aspect-video rounded-xl overflow-hidden bg-black/50 border border-white/10 shrink-0">
            {inspectedMedia.thumbnail ? (
              <img
                src={inspectedMedia.thumbnail}
                alt={inspectedMedia.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-600">
                <Film className="w-8 h-8" />
              </div>
            )}
            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[10px] font-mono font-medium text-white flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {inspectedMedia.durationStr}
            </div>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm sm:text-base font-bold text-slate-100 line-clamp-2 leading-snug">
              {inspectedMedia.title}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span className="flex items-center gap-1 text-slate-300 font-medium">
                <User className="w-3 h-3 text-lumina-cyan" />
                {inspectedMedia.uploader}
              </span>
              {inspectedMedia.viewCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Eye className="w-3 h-3" />
                  {inspectedMedia.viewCount.toLocaleString()} views
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={clearInspectedMedia}
          className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="Dismiss preview"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/40 border border-white/[0.06] w-fit">
        <button
          onClick={() => setDownloadMode('video')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            downloadMode === 'video'
              ? 'bg-lumina-cyan text-black shadow-md shadow-lumina-cyan/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Video & Audio</span>
        </button>

        <button
          onClick={() => setDownloadMode('audio')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            downloadMode === 'audio'
              ? 'bg-lumina-violet text-white shadow-md shadow-lumina-violet/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          <span>Audio Only (High-Res)</span>
        </button>
      </div>

      {/* Format Options Matrix */}
      {downloadMode === 'video' ? (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300">
            Available Video Resolutions:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {inspectedMedia.formats.map((fmt) => {
              const isSelected = selectedFormat?.formatId === fmt.formatId;
              return (
                <button
                  key={`${fmt.formatId}-${fmt.vcodec}`}
                  onClick={() => setSelectedFormat(fmt)}
                  className={`p-3 rounded-2xl text-left border transition-all relative ${
                    isSelected
                      ? 'glass-card border-lumina-cyan/60 bg-lumina-cyan/10 shadow-md shadow-lumina-cyan/15 ring-1 ring-lumina-cyan/40'
                      : 'glass-card border-white/[0.06] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white tracking-wide">
                      {fmt.resolution}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                      {fmt.vcodec}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>{fmt.fps}fps</span>
                    <span>{fmt.filesizeStr}</span>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full bg-lumina-cyan flex items-center justify-center text-black">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300">
            Audio Extraction Format:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
            {inspectedMedia.audioFormats.map((audioFmt) => {
              const isSelected = selectedAudioFormat === audioFmt.format;
              return (
                <button
                  key={audioFmt.format}
                  onClick={() => setSelectedAudioFormat(audioFmt.format)}
                  className={`p-3 rounded-2xl text-left border transition-all relative ${
                    isSelected
                      ? 'glass-card border-lumina-violet/60 bg-lumina-violet/10 shadow-md shadow-lumina-violet/15 ring-1 ring-lumina-violet/40'
                      : 'glass-card border-white/[0.06] hover:border-white/20'
                  }`}
                >
                  <div className="text-xs font-bold text-white">{audioFmt.label}</div>
                  <div className="mt-1 text-[10px] text-slate-400 font-mono leading-tight">
                    {audioFmt.bitrate}
                  </div>
                  <div className="text-[9px] text-lumina-violet font-mono mt-0.5">
                    ~{audioFmt.approxSizeStr}
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full bg-lumina-violet flex items-center justify-center text-white">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Subtitles Drawer (Only for video mode) */}
      {downloadMode === 'video' && inspectedMedia.subtitles.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-black/30 border border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-lumina-cyan" />
              <span className="text-xs font-semibold text-slate-200">Subtitles & Captions</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={includeSubtitles}
                onChange={(e) => setIncludeSubtitles(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lumina-cyan"></div>
            </label>
          </div>

          {includeSubtitles && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-white/[0.04]">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">
                  Language:
                </label>
                <select
                  value={selectedSubtitleLang}
                  onChange={(e) => setSelectedSubtitleLang(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl glass-input text-xs text-slate-200 focus:outline-none focus:border-lumina-cyan/40"
                >
                  {inspectedMedia.subtitles.map((sub) => (
                    <option key={sub.lang} value={sub.lang} className="bg-[#171A26] text-white">
                      {sub.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-4 sm:pt-5">
                <input
                  type="checkbox"
                  id="embedSubs"
                  checked={embedSubtitles}
                  onChange={(e) => setEmbedSubtitles(e.target.checked)}
                  className="rounded border-slate-700 text-lumina-cyan focus:ring-lumina-cyan"
                />
                <label htmlFor="embedSubs" className="text-xs text-slate-300 cursor-pointer">
                  Embed into video container (Soft subs)
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Start Download Action Button */}
      <div className="pt-2">
        <button
          onClick={startDownload}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-black glass-button-primary flex items-center justify-center gap-2 shadow-lg shadow-lumina-cyan/25 hover:shadow-lumina-cyan/40 transition-all"
        >
          <Download className="w-4 h-4 stroke-[2.5]" />
          <span>
            Start Download ({downloadMode === 'video' ? selectedFormat?.resolution : selectedAudioFormat.toUpperCase()})
          </span>
        </button>
      </div>
    </div>
  );
};
