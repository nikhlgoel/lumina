import React, { useEffect, useState } from 'react';
import { Folder, Play, Film, Music, RefreshCw, HardDrive, ExternalLink } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const LocalLibrary: React.FC = () => {
  const { settings } = useLuminaStore();
  const [media, setMedia] = useState<{ videos: string[]; music: string[] }>({ videos: [], music: [] });
  const [filter, setFilter] = useState<'all' | 'video' | 'music'>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadMedia = async () => {
    setIsLoading(true);
    try {
      const data = await window.luminaAPI?.getDownloadedMedia?.();
      if (data) setMedia(data);
    } catch (e) {
      console.warn('Failed to load library:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMedia();
  }, []);

  const handleOpenFile = (filePath: string) => {
    window.luminaAPI?.openFile?.(filePath);
  };

  const handleOpenDirectory = (filePath: string) => {
    window.luminaAPI?.openDirectory?.(filePath);
  };

  const allItems = [
    ...media.videos.map((p) => ({ path: p, type: 'video' as const, name: p.split('/').pop() || p })),
    ...media.music.map((p) => ({ path: p, type: 'music' as const, name: p.split('/').pop() || p }))
  ].filter((item) => {
    if (filter === 'video' && item.type !== 'video') return false;
    if (filter === 'music' && item.type !== 'music') return false;
    if (search.trim() && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-lumina-cyan" />
            Local Media Library
          </h2>
          <p className="text-xs text-slate-400">
            Browse and play all offline media saved to your internal drive or connected USB pendrives.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenDirectory(settings?.internalVideoPath || '')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-card text-xs text-slate-300 hover:text-white transition-colors"
          >
            <Folder className="w-3.5 h-3.5 text-lumina-cyan" />
            <span>Open Videos Folder</span>
          </button>
          <button
            onClick={loadMedia}
            className="p-2 rounded-xl glass-card text-slate-400 hover:text-white transition-colors"
            title="Refresh library"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.06] w-full sm:w-auto">
          {(['all', 'video', 'music'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                filter === tab
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'all' ? `All (${media.videos.length + media.music.length})` : tab === 'video' ? `Videos (${media.videos.length})` : `Music (${media.music.length})`}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter downloaded files..."
          className="w-full sm:w-64 px-3 py-2 rounded-xl glass-input text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lumina-cyan/40"
        />
      </div>

      {/* Media List */}
      {allItems.length > 0 ? (
        <div className="space-y-2">
          {allItems.map((item) => (
            <div
              key={item.path}
              className="p-3 rounded-2xl glass-card border border-white/[0.06] hover:border-white/20 transition-all flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    item.type === 'video' ? 'bg-lumina-cyan/15 text-lumina-cyan' : 'bg-lumina-violet/15 text-lumina-violet'
                  }`}
                >
                  {item.type === 'video' ? <Film className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                </div>

                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-slate-200 truncate" title={item.name}>
                    {item.name}
                  </h4>
                  <p className="text-[10px] text-slate-500 truncate">{item.path}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleOpenFile(item.path)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition-colors"
                  title="Play"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </button>
                <button
                  onClick={() => handleOpenDirectory(item.path)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition-colors"
                  title="Show in file manager"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 glass-card rounded-3xl border border-white/[0.05]">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.03] flex items-center justify-center text-slate-500">
            <Folder className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-slate-300">No media found in library</h4>
            <p className="text-xs text-slate-500 max-w-sm">
              Your downloaded movies, videos, and music will be automatically cataloged here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
