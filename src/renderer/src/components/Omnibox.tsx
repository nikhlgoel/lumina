import React, { useState, useEffect } from 'react';
import { Link2, Search, Loader2, X, ClipboardCheck } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const Omnibox: React.FC = () => {
  const { urlInput, setUrlInput, inspectUrl, isInspecting, inspectError } = useLuminaStore();
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);

  // Check clipboard on window focus
  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (
          text &&
          (text.includes('youtube.com/') ||
            text.includes('youtu.be/') ||
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
          <span>Link detected from clipboard: <strong className="font-mono underline">{clipboardUrl.slice(0, 42)}...</strong> — Click to Paste & Inspect</span>
        </button>
      )}

      {/* Input Box */}
      <form onSubmit={handleInspect} className="relative flex items-center w-full">
        <div className="absolute left-4 text-slate-400 pointer-events-none">
          <Link2 className="w-4 h-4" />
        </div>

        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste any video, movie, or song link (YouTube, Instagram, TikTok, etc.)..."
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

      {/* Error message */}
      {inspectError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <span>{inspectError}</span>
          <button onClick={() => setUrlInput('')} className="underline text-[11px] hover:text-red-300">
            Clear
          </button>
        </div>
      )}
    </div>
  );
};
