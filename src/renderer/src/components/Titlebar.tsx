import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Palette } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

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
        <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-lumina-violet to-lumina-cyan p-[1px] shadow-sm shadow-lumina-cyan/30">
          <div className="w-full h-full bg-[#0E0F17] rounded-[5px] flex items-center justify-center">
            <span className="text-[10px] font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-lumina-cyan to-lumina-violet">
              L
            </span>
          </div>
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
