import React, { useState } from 'react';
import { 
  Boxes, 
  PackageCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Play, 
  FolderDown, 
  ExternalLink, 
  X, 
  ShieldCheck, 
  FileArchive, 
  HardDrive,
  FileCode,
  Layers,
  Film
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import repack3d from '../assets/3d_download.png';

export const RepackStudio: React.FC = () => {
  const { 
    repackPackage, 
    startRepackDownload, 
    clearRepackPackage, 
    playTrack,
    settings,
    drives 
  } = useLuminaStore();

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  if (!repackPackage) return null;

  const handleSelectFolder = async () => {
    try {
      const folder = await window.luminaAPI?.selectDirectory?.();
      if (folder) {
        setSelectedFolder(folder);
      }
    } catch (e) {
      console.warn('Failed to select directory:', e);
    }
  };

  const handleDownloadAll = async () => {
    setIsStarting(true);
    try {
      await startRepackDownload(repackPackage);
    } finally {
      setIsStarting(false);
    }
  };

  const handlePreviewMedia = (part: any) => {
    if (!part.directUrl && !part.rawUrl) return;
    playTrack({
      id: `preview_${part.filename}`,
      title: part.filename,
      artist: repackPackage.title,
      duration: 'Preview Stream',
      thumbnail: '',
      url: part.directUrl || part.rawUrl
    });
  };

  const hasUsb = Boolean(settings?.autoSaveToUsb && drives.some(d => d.isRemovable));

  return (
    <div className="w-full p-6 rounded-3xl glass-panel border border-white/[0.1] shadow-2xl shadow-black/50 space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[#00f2fe]/20 via-[#9d4edd]/20 to-black p-2 border border-white/10 flex items-center justify-center shrink-0 shadow-lg">
            <img src={repack3d} alt="Repack" className="w-12 h-12 object-contain filter drop-shadow-[0_0_12px_rgba(0,242,254,0.6)]" />
            <div className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full bg-cyan-500 text-black text-[9px] font-black tracking-wider shadow-sm">
              2.0
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white/10 text-slate-300 border border-white/5">
                {repackPackage.detectedHost}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-400/20">
                {repackPackage.partsDiscoveredCount} Multi-Part Chunks
              </span>
              {repackPackage.standaloneFiles.length > 0 && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-400/20">
                  {repackPackage.standaloneFiles.length} Extra Files
                </span>
              )}
            </div>

            <h2 className="text-xl font-bold text-white mt-1 leading-snug">
              {repackPackage.title}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <span>Total Estimated Size: <strong className="text-cyan-300 font-mono">{repackPackage.totalSizeStr}</strong></span>
              <span>•</span>
              <span>Multi-Source Acceleration: <strong className="text-emerald-400">16 Parallel Streams / Part</strong></span>
            </p>
          </div>
        </div>

        {/* Clear & Dismiss Button */}
        <button
          onClick={clearRepackPackage}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors self-start md:self-auto"
          title="Dismiss Repack Studio"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Completeness & Sequence Validation Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {repackPackage.isComplete ? (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-emerald-400">100% Sequence Verified</h4>
              <p className="text-[11px] text-emerald-300/80">All consecutive archive parts (1 to {repackPackage.totalPartsExpected}) detected without any gaps.</p>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-400">Missing Parts Detected!</h4>
              <p className="text-[11px] text-amber-300/90 font-mono">Missing Part(s): #{repackPackage.missingParts.join(', #')}</p>
            </div>
          </div>
        )}

        <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-cyan-400">Zero Server Overhead</h4>
            <p className="text-[11px] text-cyan-300/80 truncate">
              {hasUsb ? 'Routing chunks directly to connected Removable USB / SSD' : 'Saving directly to Downloads/Lumina in high-speed chunks'}
            </p>
          </div>
        </div>
      </div>

      {/* Parts & Extra Files List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span className="font-semibold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Package Archive Chunks ({repackPackage.parts.length})</span>
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            {repackPackage.detectedHost}
          </span>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
          {repackPackage.parts.map((part) => (
            <div
              key={part.filename + part.partIndex}
              className="p-2.5 rounded-xl glass-card flex items-center justify-between gap-3 text-xs border border-white/[0.05] hover:border-cyan-400/30 transition-all"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-white/[0.06] text-slate-300 font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                  #{part.partIndex}
                </span>
                <FileArchive className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="truncate text-slate-200 font-medium">
                  {part.filename}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] font-mono text-slate-400">
                  {part.sizeStr !== 'Unknown' ? part.sizeStr : '~500 MB'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
                  Ready
                </span>
              </div>
            </div>
          ))}

          {/* Standalone Files (if any) */}
          {repackPackage.standaloneFiles.map((file) => (
            <div
              key={file.filename}
              className="p-2.5 rounded-xl glass-card flex items-center justify-between gap-3 text-xs border border-purple-500/20 hover:border-purple-400/40 transition-all"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {file.isPlayable ? (
                  <Film className="w-4 h-4 text-pink-400 shrink-0" />
                ) : (
                  <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
                )}
                <span className="truncate text-slate-200 font-medium">
                  {file.filename}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {file.isPlayable && (
                  <button
                    onClick={() => handlePreviewMedia(file)}
                    className="px-2.5 py-1 rounded-lg bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 flex items-center gap-1 text-[10px] font-bold transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Play Preview</span>
                  </button>
                )}
                <span className="text-[11px] font-mono text-slate-400">
                  {file.sizeStr}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Target Directory & Download CTA Action Bar */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/[0.08]">
        <div className="flex items-center gap-2 text-xs text-slate-400 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleSelectFolder}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-card border border-white/10 hover:border-white/20 text-slate-200 hover:text-white transition-all text-xs"
          >
            <FolderDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>Target: <strong className="font-mono text-cyan-300">{selectedFolder ? 'Custom Dir' : 'Auto Storage'}</strong></span>
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={clearRepackPackage}
            className="flex-1 sm:flex-none px-4 py-3 rounded-2xl glass-card text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={isStarting}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-2xl glass-button-primary text-black font-extrabold text-xs tracking-wide shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 transition-all disabled:opacity-50"
          >
            <Zap className="w-4 h-4 fill-black" />
            <span>
              {isStarting ? 'Allocating IDM Turbo Streams...' : `Download Entire Package (${repackPackage.parts.length + repackPackage.standaloneFiles.length} Chunks)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
