import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Palette } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import luminaLogo from '../assets/lumina_3d.png';

export const Titlebar: React.FC = () => {
  const [isMax, setIsMax] = useState(false);
  const { settings, cycleTheme } = useLuminaStore();

  useEffect(() => {
    window.luminaAPI?.isMaximized?.().then(setIsMax);
  }, []);

  const handleMinimize = () => window.luminaAPI?.minimizeWindow?.();
  const handleMaximize = () => {
    window.luminaAPI?.maximizeWindow?.();
    setIsMax(!isMax);
  };
  const handleClose = () => window.luminaAPI?.closeWindow?.();

  return (
    <div className="h-10 w-full flex items-center justify-between px-3.5 glass-panel border-b border-white/[0.06] drag-region select-none z-50">
      {/* Brand Icon & Title */}
      <div className="flex items-center gap-2.5">
        <div className="relative w-5 h-5 flex items-center justify-center">
          <img 
            src={luminaLogo} 
            alt="Lumina" 
            className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(0,242,254,0.6)]" 
          />
        </div>
        <span className="text-xs font-semibold tracking-wide text-slate-200">
          Lumina
        </span>
        <span className="text-[10px] text-slate-500 font-medium hidden sm:inline-block">
          Media Downloader & Player
        </span>
      </div>

      {/* Window Controls & Theme Switcher */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={cycleTheme}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-[10px] font-medium mr-1.5"
          title={`Theme: ${settings?.theme || 'onyx'} (Click to cycle themes)`}
        >
          <Palette className="w-3.5 h-3.5 text-lumina-cyan" />
          <span className="capitalize hidden md:inline">{settings?.theme || 'onyx'}</span>
        </button>

        <button
          onClick={handleMinimize}
          className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          title={isMax ? "Restore" : "Maximize"}
        >
          {isMax ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
        <button
          onClick={handleClose}
          className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500/80 transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
