import React from 'react';
import { Download, Music2, FolderClosed, Settings2, HardDrive, Usb } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, downloads, drives } = useLuminaStore();

  const activeDownloadsCount = downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'muxing' || d.status === 'transferring'
  ).length;

  const usbDrive = drives.find((d) => d.isRemovable);

  return (
    <aside className="w-60 h-full flex flex-col justify-between p-3.5 glass-panel border-r border-white/[0.06] select-none z-20">
      {/* Navigation Buttons */}
      <div className="space-y-1.5">
        <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Menu
        </div>

        <button
          onClick={() => setActiveTab('downloader')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'downloader'
              ? 'bg-lumina-cyan/15 text-lumina-cyan border border-lumina-cyan/30 shadow-sm shadow-lumina-cyan/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Download className="w-4 h-4" />
            <span>Downloader</span>
          </div>
          {activeDownloadsCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-lumina-cyan text-black animate-pulse">
              {activeDownloadsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('music')}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'music'
              ? 'bg-lumina-violet/15 text-lumina-violet border border-lumina-violet/30 shadow-sm shadow-lumina-violet/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Music2 className="w-4 h-4" />
          <span>Music Hub</span>
        </button>

        <button
          onClick={() => setActiveTab('library')}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'library'
              ? 'bg-white/10 text-white border border-white/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <FolderClosed className="w-4 h-4" />
          <span>Local Library</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
            activeTab === 'settings'
              ? 'bg-white/10 text-white border border-white/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <Settings2 className="w-4 h-4" />
          <span>Settings</span>
        </button>
      </div>

      {/* Storage Destination Status Badge */}
      <div className="p-3 rounded-2xl glass-card border border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            {usbDrive ? (
              <>
                <Usb className="w-3.5 h-3.5 text-lumina-emerald" />
                <span>USB Connected</span>
              </>
            ) : (
              <>
                <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                <span>Local Storage</span>
              </>
            )}
          </div>
          <span
            className={`w-2 h-2 rounded-full ${
              usbDrive ? 'bg-lumina-emerald shadow-sm shadow-lumina-emerald/50 animate-pulse' : 'bg-slate-500'
            }`}
          />
        </div>

        {usbDrive ? (
          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-200 font-medium truncate" title={usbDrive.label}>
              {usbDrive.label || usbDrive.name}
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Available:</span>
              <span className="font-mono text-lumina-emerald">{usbDrive.freeSpace} of {usbDrive.totalSpace}</span>
            </div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-lumina-emerald/80 rounded-full" style={{ width: '60%' }} />
            </div>
            <div className="text-[9px] text-lumina-emerald/90 bg-lumina-emerald/10 px-2 py-0.5 rounded border border-lumina-emerald/20 text-center font-medium">
              Auto-Save Active (/LuminaMedia)
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-[10px] text-slate-400">
              Target: <span className="text-slate-300">~/Videos & ~/Music</span>
            </div>
            <div className="text-[9px] text-slate-500 italic">
              Connect a USB pendrive to auto-route downloads
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
