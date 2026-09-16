import React from 'react';
import { Download, Music2, FolderClosed, Settings2, HardDrive, Usb, X, Layers } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import luminaLogo from '../assets/lumina_3d.png';

export const Sidebar: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab, 
    downloads, 
    drives, 
    settings, 
    isMobileMenuOpen, 
    setMobileMenuOpen 
  } = useLuminaStore();

  const activeDownloadsCount = downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'muxing' || d.status === 'transferring'
  ).length;

  const usbDrive = drives.find((d) => d.isRemovable);

  const isAndroid = typeof window !== 'undefined' && 
    (/Android/i.test(navigator.userAgent) || Boolean((window as any).LuminaAndroidBridge));

  const targetPathLabel = isAndroid 
    ? '/storage/emulated/0/Download/Lumina'
    : (settings?.internalDownloadPath || '~/Downloads/Lumina');

  const navItems = [
    { id: 'downloader' as const, label: 'Downloader', icon: Download, badge: activeDownloadsCount },
    { id: 'music' as const, label: 'Music Hub', icon: Music2 },
    { id: 'library' as const, label: 'Local Library', icon: FolderClosed },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 }
  ];

  const renderContent = (isDrawer = false) => (
    <div className="flex flex-col justify-between h-full space-y-4">
      {/* Navigation Links */}
      <div className="space-y-1.5">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 py-2 mb-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            <img 
              src={luminaLogo} 
              alt="Lumina" 
              className="w-7 h-7 object-contain filter drop-shadow-[0_0_10px_rgba(0,242,254,0.5)] shrink-0" 
            />
            <div className="min-w-0">
              <div className="text-xs font-bold tracking-wider text-slate-100 flex items-center gap-1.5">
                <span>LUMINA</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">2.0</span>
              </div>
              <div className="text-[9px] text-slate-400 font-medium truncate">
                {isAndroid ? 'Android Media Engine' : 'Local Media Workstation'}
              </div>
            </div>
          </div>

          {isDrawer && (
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10"
              title="Close Menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Menu
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isSelected = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                if (isDrawer) setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-3 rounded-2xl text-xs font-semibold transition-all ${
                isSelected
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-md shadow-cyan-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {Boolean(item.badge && item.badge > 0) && (
                <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-cyan-400 text-black animate-pulse">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Storage Destination Status Badge */}
      <div className="p-3 rounded-2xl glass-card border border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            {usbDrive ? (
              <>
                <Usb className="w-3.5 h-3.5 text-emerald-400" />
                <span>USB Connected</span>
              </>
            ) : (
              <>
                <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                <span>{isAndroid ? 'Phone Storage' : 'Local Storage'}</span>
              </>
            )}
          </div>
          <span
            className={`w-2 h-2 rounded-full ${
              usbDrive ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-slate-500'
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
              <span className="font-mono text-emerald-400">{usbDrive.freeSpace} of {usbDrive.totalSpace}</span>
            </div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400/80 rounded-full" style={{ width: '60%' }} />
            </div>
            <div className="text-[9px] text-emerald-300/90 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-center font-medium">
              Auto-Save Active (/LuminaMedia)
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-[10px] text-slate-400 truncate" title={targetPathLabel}>
              Target: <span className="text-slate-200 font-mono">{targetPathLabel}</span>
            </div>
            <div className="text-[9px] text-slate-500 italic">
              {isAndroid ? 'Android 11+ Scoped Media Directory' : 'Connect a USB pendrive to auto-route downloads'}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar (Strictly hidden on mobile screens) */}
      <aside className="w-60 h-full hidden md:flex flex-col justify-between p-3.5 glass-panel border-r border-white/[0.06] select-none z-20 shrink-0">
        {renderContent(false)}
      </aside>

      {/* Mobile Slide-Over Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex animate-in fade-in duration-200">
          {/* Backdrop Blur */}
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-md"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Sheet */}
          <div className="relative w-72 max-w-[85vw] h-full glass-panel border-r border-white/10 p-4 shadow-2xl z-10 flex flex-col justify-between animate-in slide-in-from-left duration-200">
            {renderContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
