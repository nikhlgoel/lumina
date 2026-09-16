import React, { useState, useEffect } from 'react';
import { Palette, Sun, Moon, ShieldCheck, X, Minus, Plus } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import luminaLogo from '../assets/lumina_3d.png';

export const Titlebar: React.FC = () => {
  const [isMax, setIsMax] = useState(false);
  const { settings, cycleTheme, toggleColorMode } = useLuminaStore();

  useEffect(() => {
    window.luminaAPI?.isMaximized?.().then(setIsMax);
  }, []);

  const handleMinimize = () => window.luminaAPI?.minimizeWindow?.();
  const handleMaximize = () => {
    window.luminaAPI?.maximizeWindow?.();
    setIsMax(!isMax);
  };
  const handleClose = () => window.luminaAPI?.closeWindow?.();

  const isLight = settings?.colorMode === 'light';

  return (
    <div className="h-10 w-full flex items-center justify-between px-3.5 glass-panel border-b border-white/[0.06] drag-region select-none z-50">
      {/* Left: macOS Traffic Lights + Brand Title */}
      <div className="flex items-center gap-3.5">
        {/* macOS Style Traffic Light Window Controls */}
        <div className="flex items-center gap-2 group no-drag">
          {/* Close - Red */}
          <button
            onClick={handleClose}
            className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/80 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
            title="Close"
          >
            <X className="w-2 h-2 text-[#4A0002] opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
          </button>

          {/* Minimize - Amber */}
          <button
            onClick={handleMinimize}
            className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/80 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
            title="Minimize"
          >
            <Minus className="w-2 h-2 text-[#4A3400] opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
          </button>

          {/* Maximize / Restore - Green */}
          <button
            onClick={handleMaximize}
            className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/80 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
            title={isMax ? "Restore" : "Maximize"}
          >
            <Plus className="w-2 h-2 text-[#0A3D0B] opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
          </button>
        </div>

        {/* Brand Icon & Name */}
        <div className="flex items-center gap-2 pl-1 border-l border-white/[0.08]">
          <div className="relative w-4 h-4 flex items-center justify-center">
            <img 
              src={luminaLogo} 
              alt="Lumina" 
              className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(0,242,254,0.6)]" 
            />
          </div>
          <span className="text-xs font-bold tracking-wide text-slate-200">
            Lumina
          </span>
          <span className="text-[10px] text-slate-500 font-medium hidden sm:inline-block">
            Media Studio
          </span>
        </div>
      </div>

      {/* Right: Anonymity Status, Theme & Light/Dark Switcher */}
      <div className="flex items-center gap-1.5 no-drag">
        {/* Anonymity Shield Indicator */}
        {settings?.anonymizeRequests && (
          <div 
            className="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-full bg-lumina-emerald/10 text-lumina-emerald border border-lumina-emerald/20 text-[10px] font-medium"
            title="Privacy Shield Active: Outgoing tracking parameters stripped & encrypted"
          >
            <ShieldCheck className="w-3 h-3" />
            <span className="tracking-tight">Anonymous</span>
          </div>
        )}

        {/* Light / Dark Mode Toggle */}
        <button
          onClick={toggleColorMode}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all text-[11px] flex items-center justify-center"
          title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
        >
          {isLight ? (
            <Sun className="w-3.5 h-3.5 text-amber-500 hover:rotate-45 transition-transform" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-lumina-cyan hover:-rotate-12 transition-transform" />
          )}
        </button>

        {/* Theme Cycle Button */}
        <button
          onClick={cycleTheme}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-[10px] font-medium"
          title={`Active Theme: ${settings?.theme || 'onyx'} (Click to cycle)`}
        >
          <Palette className="w-3.5 h-3.5 text-lumina-cyan" />
          <span className="capitalize hidden lg:inline">{settings?.theme || 'onyx'}</span>
        </button>
      </div>
    </div>
  );
};
