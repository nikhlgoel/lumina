import React, { useEffect, useRef, useState, useMemo } from 'react';
import { X, Mic2, Search, RefreshCw, Music2, Sparkles, Disc, Play } from 'lucide-react';
import clsx from 'clsx';
import { useLuminaStore } from '../store/useLuminaStore';

export const LyricsView: React.FC = () => {
  const {
    isLyricsOpen,
    setLyricsOpen,
    currentPlayingTrack,
    currentTime,
    lyricsData,
    isLoadingLyrics,
    lyricsError,
    fetchLyrics,
    seekTime
  } = useLuminaStore();

  const [isManualSearchOpen, setIsManualSearchOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customArtist, setCustomArtist] = useState('');
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  // Compute active lyric line index based on current playback time
  const activeLineIndex = useMemo(() => {
    if (!lyricsData || !lyricsData.isSynced || lyricsData.lines.length === 0) return -1;
    
    // Find the last line where line.time <= currentTime (with slight 200ms lookahead for responsiveness)
    const timeWithOffset = currentTime + 0.15;
    let index = -1;
    for (let i = 0; i < lyricsData.lines.length; i++) {
      if (lyricsData.lines[i].time <= timeWithOffset) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [lyricsData, currentTime]);

  // Autoscroll to active line
  useEffect(() => {
    if (!isLyricsOpen || isUserScrolling || activeLineIndex === -1) return;

    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [activeLineIndex, isLyricsOpen, isUserScrolling]);

  // Handle manual user scroll detection
  const handleScroll = () => {
    setIsUserScrolling(true);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    // Re-engage autoscroll after 3.5 seconds of scroll inactivity
    userScrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 3500);
  };

  const jumpToActiveLine = () => {
    setIsUserScrolling(false);
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) return;
    fetchLyrics({ title: customTitle.trim(), artist: customArtist.trim() });
    setIsManualSearchOpen(false);
  };

  if (!isLyricsOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-lumina-dark/95 backdrop-blur-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-200 select-none">
      {/* Dynamic Ambient Color Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-lumina-cyan/15 via-lumina-violet/20 to-pink-500/10 rounded-full blur-[140px] opacity-70 animate-pulse" />
        <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-lumina-violet/15 rounded-full blur-[120px] opacity-50" />
      </div>

      {/* Top Header Bar */}
      <header className="h-20 px-8 border-b border-white/[0.08] flex items-center justify-between z-10 shrink-0 glass-panel">
        <div className="flex items-center gap-4 min-w-0">
          {/* Animated Album Art */}
          <div className="relative w-12 h-12 rounded-xl overflow-hidden shadow-lg border border-white/10 shrink-0 group">
            {currentPlayingTrack?.thumbnail ? (
              <img
                src={currentPlayingTrack.thumbnail}
                alt=""
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full bg-black/40 flex items-center justify-center text-lumina-cyan">
                <Disc className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/20" />
          </div>

          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate tracking-wide flex items-center gap-2">
              <span>{currentPlayingTrack?.title || 'Unknown Track'}</span>
              {lyricsData?.isSynced && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Synced
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {currentPlayingTrack?.artist || 'Unknown Artist'}
            </p>
          </div>
        </div>

        {/* Header Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsManualSearchOpen(!isManualSearchOpen)}
            title="Search different song title"
            className={clsx(
              "px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 transition-all border",
              isManualSearchOpen
                ? "bg-lumina-cyan/20 text-lumina-cyan border-lumina-cyan/40"
                : "text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border-white/10"
            )}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Refine Song</span>
          </button>

          <button
            onClick={() => fetchLyrics()}
            title="Refresh Lyrics"
            disabled={isLoadingLyrics}
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={clsx("w-4 h-4", isLoadingLyrics && "animate-spin text-lumina-cyan")} />
          </button>

          <button
            onClick={() => setLyricsOpen(false)}
            title="Close Lyrics (Esc)"
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Manual Search Drawer */}
      {isManualSearchOpen && (
        <form
          onSubmit={handleManualSearch}
          className="px-8 py-3 bg-black/40 border-b border-white/10 flex flex-wrap items-center gap-3 z-10 animate-in slide-in-from-top duration-200"
        >
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Track title (e.g. Bohemian Rhapsody)"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-lumina-cyan/50"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <input
              type="text"
              placeholder="Artist name (optional, e.g. Queen)"
              value={customArtist}
              onChange={(e) => setCustomArtist(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-lumina-cyan/50"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-lumina-cyan text-black hover:bg-cyan-300 transition-colors shadow-sm"
          >
            Search
          </button>
        </form>
      )}

      {/* Main Lyrics Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 md:px-16 lg:px-32 py-24 scroll-smooth relative"
      >
        {/* Loading State */}
        {isLoadingLyrics && (
          <div className="max-w-2xl mx-auto space-y-6 text-center py-20">
            <div className="inline-flex p-4 rounded-2xl bg-white/5 border border-white/10 text-lumina-cyan animate-pulse">
              <Mic2 className="w-8 h-8 animate-bounce" />
            </div>
            <p className="text-sm font-medium text-slate-400">
              Synchronizing lyrics for "{currentPlayingTrack?.title}"...
            </p>
            <div className="space-y-4 max-w-md mx-auto pt-6 opacity-30">
              <div className="h-6 bg-white/20 rounded-full w-3/4 mx-auto animate-pulse" />
              <div className="h-6 bg-white/20 rounded-full w-5/6 mx-auto animate-pulse delay-75" />
              <div className="h-6 bg-white/20 rounded-full w-2/3 mx-auto animate-pulse delay-150" />
            </div>
          </div>
        )}

        {/* Error / Empty State */}
        {!isLoadingLyrics && (lyricsError || !lyricsData || lyricsData.lines.length === 0) && (
          <div className="max-w-lg mx-auto text-center py-20 space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 mx-auto flex items-center justify-center text-slate-500">
              <Music2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold text-slate-200">
              No lyrics found for this song
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
              We couldn't find synced lyrics for "{currentPlayingTrack?.title}". Try refining the title or artist name using the button above.
            </p>
            <button
              onClick={() => setIsManualSearchOpen(true)}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white border border-white/15 transition-all inline-flex items-center gap-2"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search Manual Title</span>
            </button>
          </div>
        )}

        {/* Rendered Lyrics Lines */}
        {!isLoadingLyrics && lyricsData && lyricsData.lines.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-8 py-10">
            {lyricsData.lines.map((line, idx) => {
              const isActive = idx === activeLineIndex;
              const isPast = activeLineIndex !== -1 && idx < activeLineIndex;

              return (
                <div
                  key={idx}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => {
                    if (line.time >= 0) {
                      seekTime(line.time);
                    }
                  }}
                  className={clsx(
                    "group relative cursor-pointer select-none transition-all duration-300 py-1.5 px-4 rounded-2xl flex items-center gap-4",
                    isActive
                      ? "scale-105 origin-left"
                      : isPast
                      ? "opacity-35 hover:opacity-75 scale-95"
                      : "opacity-45 hover:opacity-85 scale-95"
                  )}
                >
                  {/* Left Active Glow Indicator */}
                  {isActive && (
                    <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-lumina-cyan to-lumina-violet shadow-[0_0_15px_#00F2FE] shrink-0 animate-pulse" />
                  )}

                  {/* Play on hover icon */}
                  {line.time >= 0 && !isActive && (
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-lumina-cyan shrink-0">
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </span>
                  )}

                  {/* Lyric Text */}
                  <p
                    className={clsx(
                      "text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight transition-all duration-300 leading-relaxed",
                      isActive
                        ? "text-white font-bold bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text text-transparent drop-shadow-[0_0_25px_rgba(0,242,254,0.45)]"
                        : "text-slate-300"
                    )}
                  >
                    {line.text || '♪'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating "Re-sync to current lyric" Button */}
      {isUserScrolling && activeLineIndex !== -1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 animate-in slide-in-from-bottom-4 duration-200">
          <button
            onClick={jumpToActiveLine}
            className="px-4 py-2 rounded-full text-xs font-semibold bg-lumina-cyan text-black shadow-lg shadow-lumina-cyan/30 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Jump to current lyric</span>
          </button>
        </div>
      )}
    </div>
  );
};
