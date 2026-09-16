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
  Film,
  Server,
  Sparkles,
  CheckSquare,
  Square
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import repack3d from '../assets/3d_download.png';
import type { RepackPart, RepackMirror } from '@shared/types';

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
  const [selectedMirrorHost, setSelectedMirrorHost] = useState<string>(
    repackPackage?.mirrors?.[0]?.hostName || repackPackage?.detectedHost || 'Direct'
  );
  const [selectedDlcIndices, setSelectedDlcIndices] = useState<Set<number>>(
    new Set((repackPackage?.selectiveDlcFiles || []).map((_, i) => i))
  );
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

  // Determine active parts based on selected mirror
  const activeMirror = repackPackage.mirrors?.find(m => m.hostName === selectedMirrorHost) || {
    hostName: repackPackage.detectedHost,
    parts: repackPackage.parts,
    isComplete: repackPackage.isComplete,
    missingParts: repackPackage.missingParts,
    totalSizeStr: repackPackage.totalSizeStr,
    totalPartsExpected: repackPackage.totalPartsExpected,
    partsDiscoveredCount: repackPackage.partsDiscoveredCount
  };

  const toggleDlc = (index: number) => {
    const next = new Set(selectedDlcIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedDlcIndices(next);
  };

  const handleDownloadAll = async () => {
    setIsStarting(true);
    try {
      // Filter selective DLCs
      const filteredDlc = (repackPackage.selectiveDlcFiles || []).filter((_, i) => selectedDlcIndices.has(i));
      const packageToDownload = {
        ...repackPackage,
        parts: activeMirror.parts,
        selectiveDlcFiles: filteredDlc,
        selectedMirrorHost
      };
      await startRepackDownload(packageToDownload);
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
  const totalChunksCount = activeMirror.parts.length + repackPackage.standaloneFiles.length + selectedDlcIndices.size;

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
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white/10 text-slate-300 border border-white/5 flex items-center gap-1">
                <Server className="w-3 h-3 text-cyan-400" />
                <span>{selectedMirrorHost}</span>
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-400/20">
                {activeMirror.parts.length} Split Archive Chunks
              </span>
              {repackPackage.selectiveDlcFiles?.length > 0 && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-pink-500/15 text-pink-400 border border-pink-400/20">
                  {repackPackage.selectiveDlcFiles.length} Selective DLCs
                </span>
              )}
              {repackPackage.standaloneFiles.length > 0 && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-400/20">
                  {repackPackage.standaloneFiles.length} Extra Files
                </span>
              )}
            </div>

            <h2 className="text-xl font-bold text-white mt-1 leading-snug">
              {repackPackage.title}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Total Size: <strong className="text-cyan-300 font-mono">{activeMirror.totalSizeStr || repackPackage.totalSizeStr}</strong></span>
              <span>•</span>
              <span>Zero-Junk Filtered: <strong className="text-emerald-400">100% Binary Payloads</strong></span>
              <span>•</span>
              <span>Speed: <strong className="text-cyan-400">16 Parallel Streams / Part</strong></span>
            </p>
          </div>
        </div>

        {/* Dismiss Button */}
        <button
          onClick={clearRepackPackage}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors self-start md:self-auto"
          title="Dismiss Repack Studio"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Mirror Host Selector (if multiple mirrors like Pixeldrain, 1Fichier, MultiUp were found) */}
      {repackPackage.mirrors && repackPackage.mirrors.length > 1 && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span>Detected Mirrors & Filehosts ({repackPackage.mirrors.length}):</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {repackPackage.mirrors.map((m) => {
              const isSelected = m.hostName === selectedMirrorHost;
              return (
                <button
                  key={m.hostName}
                  type="button"
                  onClick={() => setSelectedMirrorHost(m.hostName)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-500/20'
                      : 'glass-card border-white/10 text-slate-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  <span>{m.hostName}</span>
                  <span className={`px-1.5 py-0.2 text-[10px] rounded font-mono ${m.isComplete ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                    {m.parts.length} parts ({m.isComplete ? 'Complete' : `Missing #${m.missingParts.join(',')}`})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Validation & Clean Extraction Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {activeMirror.isComplete ? (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-emerald-400">100% Sequence Verified</h4>
              <p className="text-[11px] text-emerald-300/80">
                All consecutive archive parts (1 to {activeMirror.totalPartsExpected}) on {selectedMirrorHost} detected without gaps.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-400">Missing Parts Detected!</h4>
              <p className="text-[11px] text-amber-300/90 font-mono">
                {selectedMirrorHost} is missing Part(s): #{activeMirror.missingParts.join(', #')}
              </p>
            </div>
          </div>
        )}

        <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-cyan-400">Zero-Junk Guarantee</h4>
            <p className="text-[11px] text-cyan-300/80 truncate">
              Filtered out all web trackers, CSS, JS scripts, and ads. Only genuine payloads remain.
            </p>
          </div>
        </div>
      </div>

      {/* Selective / Optional DLC Components (FitGirl / DODI language packs & bonus files) */}
      {repackPackage.selectiveDlcFiles && repackPackage.selectiveDlcFiles.length > 0 && (
        <div className="space-y-2 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-pink-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-pink-400" />
              <span>Optional & Selective DLCs (Uncheck languages/files you don't need)</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {selectedDlcIndices.size} of {repackPackage.selectiveDlcFiles.length} Selected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {repackPackage.selectiveDlcFiles.map((dlc, idx) => {
              const isChecked = selectedDlcIndices.has(idx);
              return (
                <button
                  key={dlc.filename}
                  type="button"
                  onClick={() => toggleDlc(idx)}
                  className={`p-2 rounded-xl text-left flex items-center justify-between gap-2 text-xs border transition-all ${
                    isChecked
                      ? 'bg-pink-500/10 border-pink-500/30 text-slate-200'
                      : 'bg-white/[0.02] border-white/5 text-slate-500 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-pink-400 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600 shrink-0" />
                    )}
                    <span className="truncate font-mono text-[11px]">{dlc.filename}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">{dlc.sizeStr}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Parts List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span className="font-semibold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Active Archive Chunks ({activeMirror.parts.length})</span>
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            {selectedMirrorHost}
          </span>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
          {activeMirror.parts.map((part) => (
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

          {/* Standalone Files */}
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
              {isStarting ? 'Allocating IDM Turbo Streams...' : `Download ${totalChunksCount} Chunks via IDM Turbo (16 Streams)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
