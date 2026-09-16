import React from 'react';
import { Download, Music2, FolderClosed, Settings2 } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const BottomNavBar: React.FC = () => {
  const { activeTab, setActiveTab, downloads } = useLuminaStore();

  const activeDownloadsCount = downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'muxing' || d.status === 'transferring'
  ).length;

  const tabs = [
    { id: 'downloader' as const, label: 'Downloader', icon: Download, badge: activeDownloadsCount },
    { id: 'music' as const, label: 'Music Hub', icon: Music2 },
    { id: 'library' as const, label: 'Library', icon: FolderClosed },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 }
  ];

  return (
    <nav className="md:hidden w-full shrink-0 z-40 glass-panel border-t border-white/10 px-2 py-1.5 flex items-center justify-around select-none">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
            className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all active:scale-95 ${
              isActive 
                ? 'text-cyan-300 font-bold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {/* Active Pill Indicator */}
            {isActive && (
              <div className="absolute inset-0 rounded-xl bg-cyan-500/15 border border-cyan-400/30 -z-10 shadow-sm shadow-cyan-500/20" />
            )}

            <div className="relative">
              <Icon className={`w-5 h-5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
              {Boolean(tab.badge && tab.badge > 0) && (
                <span className="absolute -top-1.5 -right-2.5 px-1.5 py-0.2 text-[9px] font-black rounded-full bg-cyan-400 text-black animate-pulse">
                  {tab.badge}
                </span>
              )}
            </div>

            <span className="text-[10px] tracking-tight mt-0.5">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
