import React, { useState, useEffect } from 'react';
import { Link2, Search, Loader2, X, ClipboardCheck, Magnet, Zap } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const Omnibox: React.FC = () => {
  const { urlInput, setUrlInput, inspectUrl, isInspecting, inspectError, selectTorrentFile } = useLuminaStore();
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);

  // Check clipboard on window focus
  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (
          text &&
          (text.startsWith('magnet:?') ||
            text.includes('.torrent') ||
            text.includes('youtube.com/') ||
            text.includes('youtu.be/') ||
            text.includes('spotify.com/') ||
            text.includes('instagram.com/') ||
            text.includes('tiktok.com/') ||
            text.includes('x.com/') ||
            text.includes('twitter.com/') ||
            text.includes('soundcloud.com/')) &&
          text !== urlInput
        ) {
          setClipboardUrl(text.trim());
        }
      } catch (e) {
        // Clipboard read permission might be restricted
      }
    };

    window.addEventListener('focus', checkClipboard);
    checkClipboard();
    return () => window.removeEventListener('focus', checkClipboard);
  }, [urlInput]);

  const handleInspect = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (urlInput.trim()) {
      inspectUrl();
    }
  };

  const handlePasteClipboard = () => {
    if (clipboardUrl) {
      setUrlInput(clipboardUrl);
      inspectUrl(clipboardUrl);
      setClipboardUrl(null);
    }
  };

  return (
    <div className="w-full space-y-2.5">
      {/* Clipboard auto-detected banner */}
      {clipboardUrl && !isInspecting && (
        <button
          onClick={handlePasteClipboard}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-card border border-lumina-cyan/30 text-xs text-lumina-cyan hover:bg-lumina-cyan/10 transition-all animate-bounce"
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          <span>
            {clipboardUrl.startsWith('magnet:?') ? 'BitTorrent magnet' : 'Link'} detected from clipboard:{' '}
            <strong className="font-mono underline">{clipboardUrl.slice(0, 38)}...</strong> — Click to Paste & Inspect
          </span>
        </button>
      )}

      {/* Input Box & Torrent File Launcher */}
      <div className="flex items-center gap-2.5">
        <form onSubmit={handleInspect} className="relative flex items-center flex-1">
          <div className="absolute left-4 text-slate-400 pointer-events-none">
            <Link2 className="w-4 h-4" />
          </div>

          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste any link (YouTube, Spotify, BitTorrent Magnet, Direct File URL, etc.)..."
            disabled={isInspecting}
            className="w-full pl-11 pr-32 py-3.5 rounded-2xl glass-input text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-lumina-cyan/50 focus:ring-2 focus:ring-lumina-cyan/20 transition-all font-sans"
          />

          {urlInput && !isInspecting && (
            <button
              type="button"
              onClick={() => setUrlInput('')}
              className="absolute right-28 p-1 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            type="submit"
            disabled={isInspecting || !urlInput.trim()}
            className="absolute right-2 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-black glass-button-primary disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            {isInspecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Inspect</span>
              </>
            )}
          </button>
        </form>

        {/* Load .torrent File Action Button */}
        <button
          onClick={selectTorrentFile}
          type="button"
          disabled={isInspecting}
          className="px-3.5 py-3.5 rounded-2xl glass-card border border-white/[0.08] hover:border-lumina-violet/60 hover:bg-lumina-violet/10 text-slate-300 hover:text-white transition-all flex items-center gap-2 text-xs font-semibold shrink-0 shadow-lg shadow-black/20"
          title="Open and download from a .torrent file"
        >
          <Magnet className="w-4 h-4 text-lumina-violet" />
          <span className="hidden md:inline">Open Torrent</span>
        </button>
      </div>

      {/* Error message */}
      {inspectError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between animate-in fade-in">
          <span>{inspectError}</span>
          <button onClick={() => setUrlInput('')} className="underline text-[11px] hover:text-red-300">
            Clear
          </button>
        </div>
      )}

      {/* Quick Suggestions & Keyboard Hint */}
      {!urlInput && !isInspecting && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 px-1 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span>Quick Test:</span>
            <button
              type="button"
              onClick={() => {
                const url = 'magnet:?xt=urn:btih:e4c27f311c16260a9203f0ec78e47c74235882e3&dn=Arch+Linux+2026.iso';
                setUrlInput(url);
                inspectUrl(url);
              }}
              className="px-2 py-0.5 rounded-md bg-lumina-violet/15 text-lumina-violet border border-lumina-violet/30 hover:bg-lumina-violet/30 transition-colors font-medium flex items-center gap-1"
            >
              <Magnet className="w-3 h-3" />
              <span>BitTorrent Magnet</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const url = 'https://speed.cloudflare.com/__down?bytes=104857600';
                setUrlInput(url);
                inspectUrl(url);
              }}
              className="px-2 py-0.5 rounded-md bg-lumina-cyan/15 text-lumina-cyan border border-lumina-cyan/30 hover:bg-lumina-cyan/30 transition-colors font-medium flex items-center gap-1"
            >
              <Zap className="w-3 h-3" />
              <span>IDM Turbo 100MB</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
                setUrlInput(url);
                inspectUrl(url);
              }}
              className="px-2 py-0.5 rounded-md bg-[#1DB954]/10 text-[#1DB954] hover:bg-[#1DB954]/25 transition-colors font-medium"
            >
              🎵 Spotify Top Hits
            </button>
            <button
              type="button"
              onClick={() => {
                const url = 'https://music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj';
                setUrlInput(url);
                inspectUrl(url);
              }}
              className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
            >
              ▶️ YT Music Pop
            </button>
          </div>

          <span className="hidden sm:inline-block text-[10px] text-slate-600 font-mono">
            Tip: Press <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">Ctrl</kbd> + <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">V</kbd> anywhere to inspect
          </span>
        </div>
      )}
    </div>
  );
};
