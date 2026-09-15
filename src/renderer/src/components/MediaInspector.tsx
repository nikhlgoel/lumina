import React, { useState } from 'react';
import { 
  Film, 
  Music, 
  Subtitles, 
  Check, 
  Download, 
  Clock, 
  User, 
  Eye, 
  X,
  ListMusic,
  FolderDown,
  ChevronDown,
  ChevronUp,
  Disc3,
  Usb,
  Magnet,
  Zap,
  Network,
  Radio,
  FileCheck
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import luminaLogo from '../assets/lumina_3d.png';
import torrent3d from '../assets/3d_torrent.png';
import music3d from '../assets/3d_music.png';
import download3d from '../assets/3d_download.png';

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
    clearInspectedMedia,
    drives,
    settings
  } = useLuminaStore();

  const [showTracklist, setShowTracklist] = useState(false);

  if (!inspectedMedia) return null;

  const isPlaylist = Boolean(inspectedMedia.isPlaylist);
  const isTorrent = Boolean(inspectedMedia.isTorrent);
  const isDirect = Boolean(inspectedMedia.isDirectFile);
  const isSpotify = inspectedMedia.playlistType === 'spotify' || inspectedMedia.url.includes('spotify.com');
  const hasUsb = Boolean(settings?.autoSaveToUsb && drives.some(d => d.isRemovable));

  const targetFolderName = (inspectedMedia.playlistTitle || inspectedMedia.title)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();

  return (
    <div className="w-full p-5 rounded-3xl glass-panel border border-white/[0.1] shadow-2xl shadow-black/40 space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Top Header: Title, Thumbnail, Creator */}
      <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
        <div className="flex gap-4 items-start min-w-0">
          <div className={`relative ${isPlaylist || isTorrent ? 'w-32 sm:w-36 aspect-square' : 'w-36 sm:w-44 aspect-video'} rounded-2xl overflow-hidden bg-black/50 border border-white/10 shrink-0 shadow-lg flex items-center justify-center`}>
            {inspectedMedia.thumbnail ? (
              <img
                src={inspectedMedia.thumbnail}
                alt={inspectedMedia.title}
                className="w-full h-full object-cover"
              />
            ) : isTorrent ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-lumina-violet/20 via-black to-lumina-cyan/10 p-2">
                <img src={torrent3d} alt="BitTorrent P2P Swarm" className="w-20 h-20 object-contain filter drop-shadow-[0_0_12px_rgba(157,78,221,0.5)]" />
                <span className="text-[10px] font-mono mt-1 text-slate-300">P2P Swarm</span>
              </div>
            ) : isDirect ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-lumina-cyan/20 via-black to-lumina-emerald/10 p-2">
                <img src={download3d} alt="IDM Turbo" className="w-20 h-20 object-contain filter drop-shadow-[0_0_12px_rgba(0,242,254,0.5)]" />
                <span className="text-[10px] font-mono mt-1 text-slate-300">IDM Turbo</span>
              </div>
            ) : isPlaylist ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-lumina-violet/20 via-black to-lumina-cyan/10 p-2">
                <img src={music3d} alt="Music Playlist" className="w-20 h-20 object-contain filter drop-shadow-[0_0_12px_rgba(157,78,221,0.5)]" />
                <span className="text-[10px] font-mono mt-1 text-slate-300">Playlist Audio</span>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-lumina-cyan/20 via-black to-lumina-violet/10 p-2">
                <img src={luminaLogo} alt="Lumina Media" className="w-16 h-16 object-contain filter drop-shadow-[0_0_12px_rgba(0,242,254,0.5)]" />
                <span className="text-[10px] font-mono mt-1 text-slate-300">Lumina Media</span>
              </div>
            )}

            <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[10px] font-mono font-medium text-white flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {inspectedMedia.durationStr}
            </div>

            {isPlaylist && (
              <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-lumina-violet/90 text-[9px] font-bold text-white uppercase tracking-wider flex items-center gap-1 shadow-md">
                <Disc3 className="w-2.5 h-2.5 animate-spin" />
                Playlist
              </div>
            )}

            {isTorrent && (
              <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-lumina-violet/90 text-[9px] font-bold text-white uppercase tracking-wider flex items-center gap-1 shadow-md">
                <Radio className="w-2.5 h-2.5 animate-pulse" />
                BitTorrent
              </div>
            )}

            {isDirect && (
              <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-lumina-cyan/90 text-[9px] font-bold text-black uppercase tracking-wider flex items-center gap-1 shadow-md">
                <Zap className="w-2.5 h-2.5" />
                IDM Turbo
              </div>
            )}
          </div>

          <div className="space-y-2 min-w-0">
            {isPlaylist && (
              <div className="flex items-center gap-2">
                {isSpotify ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#1DB954]/20 border border-[#1DB954]/40 text-[#1DB954] text-[10px] font-bold tracking-wide flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1DB954] animate-pulse" />
                    Spotify Lossless Audio Bridge
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 text-[10px] font-bold tracking-wide flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    YouTube Music Playlist
                  </span>
                )}
                <span className="text-[11px] font-mono text-slate-400">
                  {inspectedMedia.trackCount} Tracks
                </span>
              </div>
            )}

            {isTorrent && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-lumina-violet/20 border border-lumina-violet/40 text-lumina-violet text-[10px] font-bold tracking-wide flex items-center gap-1.5">
                  <Network className="w-3 h-3" />
                  P2P Distributed Swarm
                </span>
                <span className="px-2 py-0.5 rounded-full bg-lumina-emerald/15 border border-lumina-emerald/30 text-lumina-emerald text-[10px] font-mono">
                  {inspectedMedia.torrentInfo?.trackersCount || 16} Ultra-Speed Trackers
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[10px] font-mono">
                  DHT + PEX + LPD
                </span>
              </div>
            )}

            {isDirect && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-lumina-cyan/20 border border-lumina-cyan/40 text-lumina-cyan text-[10px] font-bold tracking-wide flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  IDM Turbo Multi-Connection
                </span>
                <span className="px-2 py-0.5 rounded-full bg-lumina-emerald/15 border border-lumina-emerald/30 text-lumina-emerald text-[10px] font-mono">
                  16 Parallel TCP Streams
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[10px] font-mono">
                  Byte-Range Acceleration
                </span>
              </div>
            )}

            <h3 className="text-sm sm:text-base font-bold text-slate-100 line-clamp-2 leading-snug">
              {inspectedMedia.title}
            </h3>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span className="flex items-center gap-1 text-slate-300 font-medium">
                <User className="w-3 h-3 text-lumina-cyan" />
                {inspectedMedia.uploader}
              </span>
              {!isPlaylist && !isTorrent && !isDirect && inspectedMedia.viewCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Eye className="w-3 h-3" />
                  {inspectedMedia.viewCount.toLocaleString()} views
                </span>
              )}
              {(inspectedMedia.url.includes('/shorts/') || inspectedMedia.url.includes('/reel/')) && (
                <span className="px-2 py-0.5 rounded-md bg-lumina-magenta/20 border border-lumina-magenta/40 text-lumina-magenta font-mono text-[9px] font-bold">
                  ⚡ Vertical Short / Reel
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={clearInspectedMedia}
          className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
          title="Dismiss preview"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Switcher Tabs (Shown for Video or YouTube Playlist) */}
      {!isTorrent && !isDirect && inspectedMedia.formats.length > 0 && (
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
      )}

      {/* BitTorrent Engine Parameters */}
      {isTorrent && (
        <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-lumina-violet" />
              <span className="text-xs font-semibold text-slate-200">High-Performance Swarm Acceleration</span>
            </div>
            <span className="text-[10px] font-mono text-lumina-emerald bg-lumina-emerald/10 px-2 py-0.5 rounded-md border border-lumina-emerald/20">
              Zero Bandwidth Cap
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
              <div className="text-[10px] text-slate-400">Predefined Trackers</div>
              <div className="font-semibold text-slate-200 font-mono">16 Ultra-Fast Swarms</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
              <div className="text-[10px] text-slate-400">Disk Pre-Allocation</div>
              <div className="font-semibold text-lumina-cyan font-mono">Falloc (Instant 0-Lag)</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
              <div className="text-[10px] text-slate-400">Peer Discovery</div>
              <div className="font-semibold text-slate-200 font-mono">DHT + PEX + LPD Active</div>
            </div>
          </div>
        </div>
      )}

      {/* IDM Turbo Direct File Parameters */}
      {isDirect && (
        <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-lumina-cyan" />
              <span className="text-xs font-semibold text-slate-200">IDM Multi-Segment Turbo Engine</span>
            </div>
            <span className="text-[10px] font-mono text-lumina-cyan bg-lumina-cyan/10 px-2 py-0.5 rounded-md border border-lumina-cyan/20">
              16x Acceleration
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
              <div className="text-[10px] text-slate-400">Concurrent Connections</div>
              <div className="font-semibold text-lumina-cyan font-mono">{settings?.turboConnections || 16} Parallel Streams</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
              <div className="text-[10px] text-slate-400">Chunk Segmentation</div>
              <div className="font-semibold text-slate-200 font-mono">1MB Dynamic Slices</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-1">
              <div className="text-[10px] text-slate-400">Range Request Capability</div>
              <div className="font-semibold text-lumina-emerald font-mono">Server Validated ✓</div>
            </div>
          </div>
        </div>
      )}

      {/* Format Options Matrix (For standard video/audio streams) */}
      {!isTorrent && !isDirect && (
        downloadMode === 'video' && inspectedMedia.formats.length > 0 ? (
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
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                Audio Extraction Quality & Format:
              </label>
              {isPlaylist && (
                <span className="text-[11px] text-lumina-violet font-mono font-medium">
                  Applied to all {inspectedMedia.trackCount} tracks
                </span>
              )}
            </div>
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
        )
      )}

      {/* Playlist Tracklist Drawer Accordion */}
      {isPlaylist && inspectedMedia.tracks && inspectedMedia.tracks.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-black/40 border border-white/[0.06] space-y-2">
          <button
            onClick={() => setShowTracklist(!showTracklist)}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-lumina-violet" />
              <span>Review Playlist Tracks ({inspectedMedia.tracks.length} Songs)</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <span>{showTracklist ? 'Hide List' : 'View Tracklist'}</span>
              {showTracklist ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

          {showTracklist && (
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1 pt-2 border-t border-white/[0.04]">
              {inspectedMedia.tracks.map((track, idx) => (
                <div
                  key={track.id || idx}
                  className="flex items-center justify-between p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] text-xs transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-5 text-center text-[10px] font-mono text-slate-500">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-200 truncate">{track.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">{track.artist}</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0 pl-2">
                    {track.durationStr}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subtitles Drawer (Only for single video mode) */}
      {!isPlaylist && !isTorrent && !isDirect && downloadMode === 'video' && inspectedMedia.subtitles.length > 0 && (
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

      {/* Target Destination Indicator */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-slate-300">
        {hasUsb ? (
          <Usb className="w-3.5 h-3.5 text-lumina-emerald shrink-0" />
        ) : (
          <FolderDown className="w-3.5 h-3.5 text-lumina-violet shrink-0" />
        )}
        <span className="truncate">
          Target:{' '}
          <span className="font-mono text-slate-200">
            {isPlaylist
              ? `Playlists/${targetFolderName}/`
              : isTorrent
              ? 'Torrents/'
              : isDirect
              ? 'Videos/Downloads/'
              : downloadMode === 'video'
              ? 'Videos/'
              : 'Music/'}
          </span>
          {hasUsb && <span className="text-lumina-emerald ml-1.5 font-medium">(Auto-saving to USB)</span>}
        </span>
      </div>

      {/* Start Download Action Button */}
      <div className="pt-2">
        <button
          onClick={async () => {
            await startDownload();
            clearInspectedMedia();
          }}
          className={`w-full py-3.5 rounded-2xl text-sm font-bold text-black flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.99] ${
            isTorrent
              ? 'bg-gradient-to-r from-lumina-violet via-lumina-cyan to-lumina-emerald text-white hover:brightness-110 shadow-lumina-violet/25 hover:shadow-lumina-violet/40'
              : isDirect
              ? 'bg-gradient-to-r from-lumina-cyan via-lumina-emerald to-lumina-cyan text-black hover:brightness-110 shadow-lumina-cyan/25 hover:shadow-lumina-cyan/40'
              : isPlaylist
              ? 'bg-gradient-to-r from-lumina-violet via-lumina-cyan to-lumina-emerald text-white hover:brightness-110 shadow-lumina-violet/25 hover:shadow-lumina-violet/40'
              : 'glass-button-primary shadow-lumina-cyan/25 hover:shadow-lumina-cyan/40'
          }`}
        >
          {isTorrent ? (
            <>
              <Magnet className="w-4 h-4 stroke-[2.5]" />
              <span>Start Turbo Torrent Download (16+ Trackers, DHT, PEX)</span>
            </>
          ) : isDirect ? (
            <>
              <Zap className="w-4 h-4 stroke-[2.5]" />
              <span>Start IDM Turbo Download (16 Parallel Segments)</span>
            </>
          ) : isPlaylist ? (
            <>
              <FolderDown className="w-4 h-4 stroke-[2.5]" />
              <span>
                Download Entire Playlist ({inspectedMedia.trackCount} Tracks) as {selectedAudioFormat.toUpperCase()}
              </span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>
                Start Download ({downloadMode === 'video' ? selectedFormat?.resolution : selectedAudioFormat.toUpperCase()})
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
