import React from 'react';
import { 
  Play, 
  Folder, 
  XCircle, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  Usb, 
  Film, 
  Music,
  ListMusic,
  FolderOpen
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const DownloadQueue: React.FC = () => {
  const { downloads, cancelDownload, clearCompletedDownloads, activeTasksMetadata } = useLuminaStore();

  if (downloads.length === 0) {
    return (
      <div className="w-full py-12 flex flex-col items-center justify-center text-center space-y-3 glass-card rounded-3xl border border-white/[0.05]">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.03] flex items-center justify-center text-slate-500">
          <Layers className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-slate-300">No active downloads</h4>
          <p className="text-xs text-slate-500 max-w-sm">
            Paste a link above or search for music in the Music Hub to start downloading.
          </p>
        </div>
      </div>
    );
  }

  const handleOpenFile = (path?: string) => {
    if (path) window.luminaAPI?.openFile?.(path);
  };

  const handleOpenFolder = (path?: string) => {
    if (path) window.luminaAPI?.openDirectory?.(path);
  };

  const hasFinished = downloads.some(
    (d) => d.status === 'completed' || d.status === 'error' || d.status === 'cancelled'
  );

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Download Queue ({downloads.length})
        </h3>
        {hasFinished && (
          <button
            onClick={clearCompletedDownloads}
            className="text-[11px] font-medium text-slate-400 hover:text-white px-2 py-0.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            Clear Finished
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {downloads.map((item) => {
          const meta = activeTasksMetadata.get(item.taskId);
          const isDone = item.status === 'completed';
          const isError = item.status === 'error';
          const isTransferring = item.status === 'transferring';
          const isMuxing = item.status === 'muxing';
          const isPlaylist = Boolean(item.totalTracks && item.totalTracks > 0);

          return (
            <div
              key={item.taskId}
              className="p-4 rounded-2xl glass-card border border-white/[0.08] hover:border-white/20 transition-all space-y-3 shadow-lg shadow-black/20"
            >
              {/* Header Info */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/40 border border-white/10 shrink-0 flex items-center justify-center">
                    {meta?.thumbnail ? (
                      <img src={meta.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : isPlaylist ? (
                      <ListMusic className="w-5 h-5 text-lumina-violet" />
                    ) : meta?.mode?.includes('MP3') || meta?.mode?.includes('FLAC') ? (
                      <Music className="w-4 h-4 text-lumina-violet" />
                    ) : (
                      <Film className="w-4 h-4 text-lumina-cyan" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-semibold text-slate-100 truncate" title={meta?.title}>
                        {meta?.title || 'Downloading Media...'}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span>{meta?.uploader || 'Media Stream'}</span>
                      {meta?.mode && (
                        <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] ${
                          meta.mode.includes('SPOTIFY') 
                            ? 'bg-[#1DB954]/20 text-[#1DB954] font-bold' 
                            : meta.mode.includes('YT PLAYLIST')
                            ? 'bg-red-500/20 text-red-300 font-bold'
                            : 'bg-white/10 text-slate-300'
                        }`}>
                          {meta.mode}
                        </span>
                      )}
                      {isPlaylist && item.currentTrackIndex !== undefined && (
                        <span className="px-1.5 py-0.2 rounded bg-lumina-violet/20 text-lumina-violet font-mono text-[9px] font-bold">
                          Track {item.currentTrackIndex} of {item.totalTracks}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stage Badge & Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {isDone ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-lumina-emerald/15 text-lumina-emerald border border-lumina-emerald/30 text-[10px] font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      Completed
                    </span>
                  ) : isError ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] font-semibold">
                      <AlertCircle className="w-3 h-3" />
                      Error
                    </span>
                  ) : isTransferring ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-lumina-emerald/15 text-lumina-emerald border border-lumina-emerald/30 text-[10px] font-semibold animate-pulse">
                      <Usb className="w-3 h-3" />
                      Saving to USB
                    </span>
                  ) : isMuxing ? (
                    <span className="px-2.5 py-1 rounded-full bg-lumina-amber/15 text-lumina-amber border border-lumina-amber/30 text-[10px] font-semibold animate-pulse">
                      Muxing with FFmpeg
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-lumina-cyan/15 text-lumina-cyan border border-lumina-cyan/30 text-[10px] font-semibold">
                      Downloading
                    </span>
                  )}

                  {!isDone && !isError && (
                    <button
                      onClick={() => cancelDownload(item.taskId)}
                      className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-red-400 transition-colors"
                      title="Cancel download"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}

                  {isDone && (
                    <div className="flex items-center gap-1">
                      {!isPlaylist && (
                        <button
                          onClick={() => handleOpenFile(item.outputPath)}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition-colors"
                          title="Open file"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenFolder(item.outputPath)}
                        className="p-1.5 rounded-lg bg-lumina-cyan/20 hover:bg-lumina-cyan/30 text-lumina-cyan border border-lumina-cyan/30 transition-colors flex items-center gap-1 text-[11px] font-medium px-2"
                        title={isPlaylist ? "Open Playlist Folder" : "Show in folder"}
                      >
                        {isPlaylist ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                        {isPlaylist && <span>Open Folder</span>}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Track */}
              <div className="space-y-1.5">
                <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden relative">
                  <div
                    className={`h-full transition-all duration-200 relative ${
                      isDone
                        ? 'bg-lumina-emerald'
                        : isError
                        ? 'bg-red-500'
                        : isPlaylist
                        ? 'bg-gradient-to-r from-lumina-violet via-lumina-cyan to-lumina-emerald'
                        : 'bg-gradient-to-r from-lumina-violet to-lumina-cyan'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
                  >
                    {!isDone && !isError && (
                      <div className="absolute right-0 top-0 bottom-0 w-2 bg-white shadow-sm shadow-lumina-cyan glow-cyan animate-pulse" />
                    )}
                  </div>
                </div>

                {/* Metrics Line */}
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="truncate max-w-[60%]">{item.stage}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    {!isDone && !isError && (
                      <>
                        <span>{item.speed}</span>
                        <span>ETA: {item.eta}</span>
                      </>
                    )}
                    <span className="font-bold text-slate-200">{Math.round(item.percent)}%</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
