import React, { useState, useEffect } from 'react';
import { 
  Link2, 
  Search, 
  Loader2, 
  X, 
  ClipboardCheck, 
  Magnet, 
  Zap, 
  Boxes, 
  Layers, 
  ChevronDown, 
  ChevronUp 
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const Omnibox: React.FC = () => {
  const { 
    urlInput, 
    setUrlInput, 
    inspectUrl, 
    crawlMultiLinks,
    isInspecting, 
    isCrawlingRepack,
    inspectError, 
    selectTorrentFile 
  } = useLuminaStore();

  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [isMultiLineMode, setIsMultiLineMode] = useState<boolean>(false);

  // Check clipboard on window focus
  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (
          text &&
          (text.startsWith('magnet:?') ||
            text.includes('.torrent') ||
            text.includes('.part') ||
            text.includes('fitgirl') ||
            text.includes('dodi') ||
            text.includes('youtube.com/') ||
            text.includes('youtu.be/') ||
            text.includes('spotify.com/') ||
            text.includes('pixeldrain.com/') ||
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
    if (!urlInput.trim()) return;

    // Check if input has multiple lines or multiple URLs
    const matches = urlInput.match(/(https?:\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/gi);
    if (matches && matches.length > 1) {
      crawlMultiLinks(urlInput);
    } else {
      inspectUrl();
    }
  };

  const handlePasteClipboard = () => {
    if (clipboardUrl) {
      setUrlInput(clipboardUrl);
      const matches = clipboardUrl.match(/(https?:\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/gi);
      if (matches && matches.length > 1) {
        crawlMultiLinks(clipboardUrl);
      } else {
        inspectUrl(clipboardUrl);
      }
      setClipboardUrl(null);
    }
  };

  const loadSampleRepack = () => {
    const sampleFitGirlLinks = [
      'https://pixeldrain.com/u/sample1_fg_Cyberpunk2077.part01.rar',
      'https://pixeldrain.com/u/sample2_fg_Cyberpunk2077.part02.rar',
      'https://pixeldrain.com/u/sample3_fg_Cyberpunk2077.part03.rar',
      'https://pixeldrain.com/u/sample4_fg_Cyberpunk2077.part04.rar',
      'https://pixeldrain.com/u/sample5_fg_Cyberpunk2077.part05.rar',
      'https://speed.cloudflare.com/__down?bytes=524288000#setup.exe',
      'https://speed.cloudflare.com/__down?bytes=10485760#fg-optional-soundtrack.mp3'
    ].join('\n');

    setUrlInput(sampleFitGirlLinks);
    setIsMultiLineMode(true);
    crawlMultiLinks(sampleFitGirlLinks);
  };

  const isLoading = isInspecting || isCrawlingRepack;

  return (
    <div className="w-full space-y-2.5">
      {/* Clipboard auto-detected banner */}
      {clipboardUrl && !isLoading && (
        <button
          onClick={handlePasteClipboard}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-card border border-lumina-cyan/30 text-xs text-lumina-cyan hover:bg-lumina-cyan/10 transition-all animate-bounce"
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          <span>
            {clipboardUrl.includes('\n') || (clipboardUrl.match(/http/g) || []).length > 1 
              ? 'Multi-Link Repack batch detected from clipboard'
              : clipboardUrl.startsWith('magnet:?') ? 'BitTorrent magnet detected' : 'Link detected'}
            :{' '}
            <strong className="font-mono underline">{clipboardUrl.slice(0, 35)}...</strong> — Click to Auto-Inspect
          </span>
        </button>
      )}

      {/* Input Box & Torrent File Launcher */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <form onSubmit={handleInspect} className="relative flex-1">
            <div className="absolute left-4 top-4 text-slate-400 pointer-events-none">
              {isMultiLineMode ? <Boxes className="w-4 h-4 text-cyan-400" /> : <Link2 className="w-4 h-4" />}
            </div>

            {isMultiLineMode ? (
              <textarea
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste multiple download links, 500MB split chunks, or FitGirl/DODI repack links (one per line)..."
                disabled={isLoading}
                rows={4}
                className="w-full pl-11 pr-32 py-3 rounded-2xl glass-input text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 transition-all font-mono resize-y"
              />
            ) : (
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setUrlInput(val);
                  if (val.includes('\n') || (val.match(/https?:\/\//g) || []).length > 1) {
                    setIsMultiLineMode(true);
                  }
                }}
                placeholder="Paste any link, BitTorrent magnet, or 10-100+ Repack links..."
                disabled={isLoading}
                className="w-full pl-11 pr-32 py-3.5 rounded-2xl glass-input text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 transition-all font-sans"
              />
            )}

            {urlInput && !isLoading && (
              <button
                type="button"
                onClick={() => setUrlInput('')}
                className="absolute right-28 top-3.5 p-1 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading || !urlInput.trim()}
              className="absolute right-2 top-2 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-black glass-button-primary disabled:opacity-40 disabled:pointer-events-none transition-all shadow-md shadow-cyan-500/20"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isCrawlingRepack ? 'Crawling Repack...' : 'Analyzing...'}</span>
                </>
              ) : (
                <>
                  {isMultiLineMode || (urlInput.match(/https?:\/\//g) || []).length > 1 ? (
                    <>
                      <Layers className="w-3.5 h-3.5" />
                      <span>Crawl Batch</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-3.5 h-3.5" />
                      <span>Inspect</span>
                    </>
                  )}
                </>
              )}
            </button>
          </form>

          {/* Mode toggle button (Single vs Multi-Link) */}
          <button
            onClick={() => setIsMultiLineMode(!isMultiLineMode)}
            type="button"
            className="px-3 py-3.5 rounded-2xl glass-card border border-white/[0.08] hover:border-cyan-400/40 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-semibold shrink-0"
            title={isMultiLineMode ? 'Switch to Single URL input' : 'Switch to Multi-Link Paste Studio'}
          >
            <Boxes className="w-4 h-4 text-cyan-400" />
            <span className="hidden lg:inline">{isMultiLineMode ? 'Single' : 'Multi-Link'}</span>
            {isMultiLineMode ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Load .torrent File Action Button */}
          <button
            onClick={selectTorrentFile}
            type="button"
            disabled={isLoading}
            className="px-3.5 py-3.5 rounded-2xl glass-card border border-white/[0.08] hover:border-purple-500/60 hover:bg-purple-500/10 text-slate-300 hover:text-white transition-all flex items-center gap-2 text-xs font-semibold shrink-0 shadow-lg shadow-black/20"
            title="Open and download from a .torrent file"
          >
            <Magnet className="w-4 h-4 text-purple-400" />
            <span className="hidden md:inline">Open Torrent</span>
          </button>
        </div>
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

      {/* Quick Suggestions & Repack Sampler */}
      {!urlInput && !isLoading && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 px-1 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-slate-400">Quick Test:</span>
            
            <button
              type="button"
              onClick={loadSampleRepack}
              className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-400/30 hover:bg-cyan-500/30 transition-colors font-medium flex items-center gap-1.5 shadow-sm"
            >
              <Boxes className="w-3 h-3 text-cyan-400" />
              <span>🎮 Repack Multi-Chunk (FitGirl Sample)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const url = 'magnet:?xt=urn:btih:e4c27f311c16260a9203f0ec78e47c74235882e3&dn=Arch+Linux+2026.iso';
                setUrlInput(url);
                inspectUrl(url);
              }}
              className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors font-medium flex items-center gap-1"
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
              className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-400/30 hover:bg-cyan-500/30 transition-colors font-medium flex items-center gap-1"
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
              🎵 Spotify Hits
            </button>
          </div>

          <span className="hidden sm:inline-block text-[10px] text-slate-500 font-mono">
            Paste 10-100+ repack chunks or press <kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded bg-white/10 text-slate-300">V</kbd>
          </span>
        </div>
      )}
    </div>
  );
};
