import React, { useState, useEffect } from 'react';
import { Palette, Sun, Moon, ShieldCheck, X, Minus, Plus, Menu } from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';
import luminaLogo from '../assets/lumina_3d.png';

export const Titlebar: React.FC = () => {
  const [isMax, setIsMax] = useState(false);
  const { settings, cycleTheme, toggleColorMode, toggleMobileMenu } = useLuminaStore();

  const isDesktopElectron = typeof window !== 'undefined' && 
    Boolean(window.luminaAPI?.minimizeWindow) && 
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(window as any).LuminaAndroidBridge;

  useEffect(() => {
    if (isDesktopElectron) {
      window.luminaAPI?.isMaximized?.().then(setIsMax);
    }
  }, [isDesktopElectron]);

  const handleMinimize = () => window.luminaAPI?.minimizeWindow?.();
  const handleMaximize = () => {
    window.luminaAPI?.maximizeWindow?.();
    setIsMax(!isMax);
  };
  const handleClose = () => window.luminaAPI?.closeWindow?.();

  const isLight = settings?.colorMode === 'light';

  return (
    <div className="h-11 w-full flex items-center justify-between px-3 sm:px-4 glass-panel border-b border-white/[0.06] drag-region select-none z-50">
      {/* Left Section */}
      <div className="flex items-center gap-2.5">
        {/* Desktop ONLY: macOS Traffic Lights (strictly hidden on Android & mobile screens) */}
        {isDesktopElectron && (
          <div className="hidden md:flex items-center gap-2 group no-drag mr-2">
            <button
              onClick={handleClose}
              className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/80 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
              title="Close"
            >
              <X className="w-2 h-2 text-[#4A0002] opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
            </button>

            <button
              onClick={handleMinimize}
              className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/80 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
              title="Minimize"
            >
              <Minus className="w-2 h-2 text-[#4A3400] opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
            </button>

            <button
              onClick={handleMaximize}
              className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/80 flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
              title={isMax ? "Restore" : "Maximize"}
            >
              <Plus className="w-2 h-2 text-[#0A3D0B] opacity-0 group-hover:opacity-100 transition-opacity stroke-[3]" />
            </button>
          </div>
        )}

        {/* Mobile ONLY: Clickable Hamburger Menu Icon */}
        <button
          onClick={toggleMobileMenu}
          type="button"
          className="md:hidden p-1.5 rounded-xl text-slate-300 hover:text-white bg-white/[0.06] hover:bg-white/10 active:scale-95 transition-all no-drag"
          title="Open Navigation Menu"
        >
          <Menu className="w-4 h-4 text-cyan-400" />
        </button>

        {/* Brand Icon & Name */}
        <div className="flex items-center gap-2">
          <div className="relative w-5 h-5 flex items-center justify-center">
            <img 
              src={luminaLogo} 
              alt="Lumina" 
              className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(0,242,254,0.6)]" 
            />
          </div>
          <span className="text-xs font-bold tracking-wider text-slate-200">
            Lumina
          </span>
          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
            2.0
          </span>
        </div>
      </div>

      {/* Right Section: Theme Toggle & Controls */}
      <div className="flex items-center gap-1.5 no-drag">
        {/* Privacy Shield Indicator */}
        {settings?.anonymizeRequests && (
          <div 
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-medium"
            title="Privacy Shield Active: Metadata and tracking stripped"
          >
            <ShieldCheck className="w-3 h-3" />
            <span className="tracking-tight hidden sm:inline">Protected</span>
          </div>
        )}

        {/* Light / Dark Mode Toggle */}
        <button
          onClick={toggleColorMode}
          className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all text-[11px] flex items-center justify-center"
          title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
        >
          {isLight ? (
            <Sun className="w-4 h-4 text-amber-500 hover:rotate-45 transition-transform" />
          ) : (
            <Moon className="w-4 h-4 text-cyan-400 hover:-rotate-12 transition-transform" />
          )}
        </button>

        {/* Theme Cycle Button */}
        <button
          onClick={cycleTheme}
          className="flex items-center gap-1.5 px-2 py-1 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-[10px] font-medium"
          title={`Active Theme: ${settings?.theme || 'onyx'} (Tap to cycle)`}
        >
          <Palette className="w-3.5 h-3.5 text-cyan-400" />
          <span className="capitalize hidden lg:inline">{settings?.theme || 'onyx'}</span>
        </button>
      </div>
    </div>
  );
};
