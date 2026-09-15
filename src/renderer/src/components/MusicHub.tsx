import React, { useState } from 'react';
import { Search, Music2, Play, Download, Loader2, Sparkles, Disc3 } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import type { MusicTrack } from '@shared/types';

export const MusicHub: React.FC = () => {
  const { 
    musicQuery, 
    setMusicQuery, 
    searchMusic, 
    musicSearchResults, 
    isSearchingMusic, 
    playTrack, 
    quickDownloadTrack 
  } = useLuminaStore();

  const [selectedTrackForDl, setSelectedTrackForDl] = useState<MusicTrack | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (musicQuery.trim()) {
      searchMusic(musicQuery);
    }
  };

  const handleQuickTag = (tag: string) => {
    setMusicQuery(tag);
    searchMusic(tag);
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300">
      {/* Header & Search */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Disc3 className="w-5 h-5 text-lumina-violet animate-spin-slow" />
              Music Hub
            </h2>
            <p className="text-xs text-slate-400">
              Discover songs, stream in-app, or download in lossless FLAC / 320k MP3 with embedded album art.
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="relative flex items-center w-full">
          <div className="absolute left-4 text-slate-400 pointer-events-none">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={musicQuery}
            onChange={(e) => setMusicQuery(e.target.value)}
            placeholder="Search tracks, artists, synthwave, albums..."
            className="w-full pl-11 pr-28 py-3.5 rounded-2xl glass-input text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-lumina-violet/50 focus:ring-2 focus:ring-lumina-violet/20 transition-all"
          />
          <button
            type="submit"
            disabled={isSearchingMusic || !musicQuery.trim()}
            className="absolute right-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-lumina-violet to-purple-600 hover:from-purple-500 hover:to-lumina-violet transition-all shadow-md shadow-lumina-violet/30 disabled:opacity-40"
          >
            {isSearchingMusic ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </form>

        {/* Quick Genre Tags */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-lumina-violet" />
            Trending:
          </span>
          {['Lo-Fi Chill', 'Synthwave 80s', 'Cyberpunk Beats', 'Classical Piano', 'Rock Hits'].map((genre) => (
            <button
              key={genre}
              onClick={() => handleQuickTag(genre)}
              className="px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-slate-300 transition-colors"
            >
              {genre}
            </button>
          ))}
        </div>
      </div>

      {/* Results Grid */}
      {isSearchingMusic ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-lumina-violet animate-spin" />
          <span className="text-xs text-slate-400">Discovering music tracks...</span>
        </div>
      ) : musicSearchResults.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {musicSearchResults.map((track) => (
            <div
              key={track.id}
              className="group relative p-3 rounded-2xl glass-card border border-white/[0.06] hover:border-lumina-violet/40 transition-all space-y-2.5 hover:shadow-xl hover:shadow-lumina-violet/10"
            >
              {/* Thumbnail with Hover Overlay */}
              <div className="relative aspect-square rounded-xl overflow-hidden bg-black/40 border border-white/10">
                <img
                  src={track.thumbnail}
                  alt={track.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />

                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => playTrack(track)}
                    className="w-10 h-10 rounded-full bg-lumina-violet text-white flex items-center justify-center shadow-lg shadow-lumina-violet/50 hover:scale-110 active:scale-95 transition-all"
                    title="Play track"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                  <button
                    onClick={() => setSelectedTrackForDl(selectedTrackForDl?.id === track.id ? null : track)}
                    className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md text-white flex items-center justify-center hover:bg-white/30 hover:scale-110 active:scale-95 transition-all"
                    title="Download options"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>

                <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono text-white">
                  {track.duration}
                </div>
              </div>

              {/* Title & Artist */}
              <div className="space-y-0.5">
                <h4 className="text-xs font-semibold text-slate-100 truncate" title={track.title}>
                  {track.title}
                </h4>
                <p className="text-[11px] text-slate-400 truncate">{track.artist}</p>
              </div>

              {/* Format selection popover for download */}
              {selectedTrackForDl?.id === track.id && (
                <div className="p-2.5 rounded-xl bg-[#10121A] border border-lumina-violet/40 space-y-1.5 shadow-xl animate-in fade-in zoom-in-95">
                  <div className="text-[10px] font-semibold text-lumina-violet uppercase">
                    Choose Format:
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    <button
                      onClick={() => {
                        quickDownloadTrack(track, 'flac');
                        setSelectedTrackForDl(null);
                      }}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-lumina-violet hover:text-white transition-colors"
                    >
                      FLAC Lossless
                    </button>
                    <button
                      onClick={() => {
                        quickDownloadTrack(track, 'mp3');
                        setSelectedTrackForDl(null);
                      }}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-lumina-violet hover:text-white transition-colors"
                    >
                      MP3 320k
                    </button>
                    <button
                      onClick={() => {
                        quickDownloadTrack(track, 'opus');
                        setSelectedTrackForDl(null);
                      }}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-lumina-violet hover:text-white transition-colors"
                    >
                      OPUS Native
                    </button>
                    <button
                      onClick={() => {
                        quickDownloadTrack(track, 'wav');
                        setSelectedTrackForDl(null);
                      }}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-lumina-violet hover:text-white transition-colors"
                    >
                      WAV Studio
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 glass-card rounded-3xl border border-white/[0.05]">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.03] flex items-center justify-center text-slate-500">
            <Music2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-slate-300">Discover Unlimited Music</h4>
            <p className="text-xs text-slate-500 max-w-sm">
              Search by song title, band, or genre to stream instantly and download to your library or pendrive.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
