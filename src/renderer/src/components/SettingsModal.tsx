import React, { useState } from 'react';
import { 
  Settings2, 
  HardDrive, 
  Film, 
  Cpu, 
  ShieldCheck, 
  Folder, 
  Check, 
  Sparkles,
  Sun,
  Moon,
  Palette,
  Layers,
  Lock
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const SettingsModal: React.FC = () => {
  const { settings, saveSettings } = useLuminaStore();
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'storage' | 'formats' | 'performance' | 'antibot'>('general');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!settings) return null;

  const handleUpdate = async (patch: any) => {
    await saveSettings(patch);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleSelectFolder = async (key: 'internalVideoPath' | 'internalMusicPath') => {
    const selected = await window.luminaAPI?.selectDirectory?.();
    if (selected) {
      handleUpdate({ [key]: selected });
    }
  };

  const isAndroid = typeof window !== 'undefined' && 
    (/Android/i.test(navigator.userAgent) || Boolean((window as any).LuminaAndroidBridge) || Boolean(window.luminaAPI?.isAndroid));

  const THEMES = [
    { id: 'onyx', name: 'Onyx Dark', desc: 'Obsidian & Neon Cyan', dot1: '#00F2FE', dot2: '#9D4EDD' },
    { id: 'cyber', name: 'Cyberpunk', desc: 'Neon Yellow & Magenta', dot1: '#FFE600', dot2: '#F72585' },
    { id: 'arctic', name: 'Arctic Frost', desc: 'Glacial Ice & Indigo', dot1: '#38BDF8', dot2: '#6366F1' },
    { id: 'teal', name: 'Emerald Teal', desc: 'Deep Sea & Mint', dot1: '#14B8A6', dot2: '#10B981' },
    { id: 'sunset', name: 'Sunset Glow', desc: 'Coral & Tangerine', dot1: '#FF6B6B', dot2: '#FF9F43' },
    { id: 'amethyst', name: 'Amethyst', desc: 'Royal Purple & Lilac', dot1: '#845EC2', dot2: '#D65DB1' },
  ] as const;

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-slate-400" />
            Lumina Settings
          </h2>
          <p className="text-xs text-slate-400">
            Customize themes, appearance mode, download speed, storage destinations, and privacy shields.
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-lumina-emerald/15 text-lumina-emerald border border-lumina-emerald/30 text-xs font-semibold animate-in fade-in">
            <Check className="w-3.5 h-3.5" />
            <span>Settings Saved</span>
          </div>
        )}
      </div>

      {/* Sub-Tab Navigation (Touch & Mobile friendly horizontal scrolling) */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-black/40 border border-white/[0.06] w-full overflow-x-auto no-scrollbar scroll-smooth">
        {[
          { id: 'general' as const, label: 'Theme & Appearance', icon: Sparkles },
          { id: 'performance' as const, label: 'Speed & Turbo', icon: Cpu },
          { id: 'storage' as const, label: 'Storage & USB', icon: HardDrive },
          { id: 'formats' as const, label: 'Media & Quality', icon: Film },
          { id: 'antibot' as const, label: 'Privacy Shield', icon: ShieldCheck }
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                isSelected
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Settings Card */}
      <div className="p-4 sm:p-5 rounded-3xl glass-panel border border-white/[0.08] space-y-6">
        {/* Panel: Theme & Appearance */}
        {activeSubTab === 'general' && (
          <div className="space-y-5">
            {/* Color Mode Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Sun className="w-4 h-4 text-amber-400" />
                    Color Mode
                  </h3>
                  <p className="text-xs text-slate-400">
                    Switch between sleek OLED Dark Mode and clean high-contrast Light Mode.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Dark Mode Option */}
                <button
                  onClick={() => handleUpdate({ colorMode: 'dark' })}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all text-left ${
                    settings.colorMode === 'dark'
                      ? 'bg-white/[0.08] border-lumina-cyan text-white shadow-lg'
                      : 'bg-black/20 border-white/[0.06] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#08090D] border border-white/10 flex items-center justify-center text-lumina-cyan">
                    <Moon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Dark Mode</div>
                    <div className="text-[11px] text-slate-400">Deep obsidian & ambient glow</div>
                  </div>
                  {settings.colorMode === 'dark' && (
                    <Check className="w-4 h-4 text-lumina-cyan ml-auto" />
                  )}
                </button>

                {/* Light Mode Option */}
                <button
                  onClick={() => handleUpdate({ colorMode: 'light' })}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all text-left ${
                    settings.colorMode === 'light'
                      ? 'bg-white/[0.08] border-lumina-cyan text-white shadow-lg'
                      : 'bg-black/20 border-white/[0.06] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-300 flex items-center justify-center text-amber-500">
                    <Sun className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Light Mode</div>
                    <div className="text-[11px] text-slate-400">Crisp, high-contrast daylight</div>
                  </div>
                  {settings.colorMode === 'light' && (
                    <Check className="w-4 h-4 text-lumina-cyan ml-auto" />
                  )}
                </button>
              </div>
            </div>

            {/* Theme Selector Section */}
            <div className="space-y-2 pt-3 border-t border-white/[0.06]">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-lumina-violet" />
                  Accent Color Themes
                </h3>
                <p className="text-xs text-slate-400">
                  Select your preferred ambient lighting & color palette.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {THEMES.map((t) => {
                  const isSelected = settings.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleUpdate({ theme: t.id })}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        isSelected
                          ? 'bg-white/[0.08] border-lumina-cyan shadow-md'
                          : 'bg-black/20 border-white/[0.06] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span 
                            className="w-3 h-3 rounded-full border border-white/20" 
                            style={{ backgroundColor: t.dot1 }}
                          />
                          <span 
                            className="w-3 h-3 rounded-full border border-white/20" 
                            style={{ backgroundColor: t.dot2 }}
                          />
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-lumina-cyan" />}
                      </div>
                      <div className="text-xs font-bold text-white">{t.name}</div>
                      <div className="text-[10px] text-slate-400">{t.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ambient Shader & Blur */}
            <div className="pt-3 border-t border-white/[0.06] space-y-4">
              <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Interactive Ambient Backdrop</div>
                  <div className="text-[11px] text-slate-500">
                    60fps floating ambient gradient canvas reacting to music playback and network downloads.
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.ambientShader}
                    onChange={(e) => handleUpdate({ ambientShader: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lumina-cyan"></div>
                </label>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Glassmorphism Blur:</span>
                  <span className="font-mono text-lumina-cyan">{settings.blurIntensity}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  value={settings.blurIntensity}
                  onChange={(e) => handleUpdate({ blurIntensity: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumina-cyan"
                />
              </div>
            </div>
          </div>
        )}

        {/* Panel: Speed & Turbo Performance */}
        {activeSubTab === 'performance' && (
          <div className="space-y-5">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">High-Speed Acceleration & Concurrency</h3>
              <p className="text-xs text-slate-400">
                Optimize playlist downloads, multi-connection fragment streaming, and BitTorrent swarm speeds.
              </p>
            </div>

            {/* Playlist Concurrency Pool */}
            <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-lumina-emerald" />
                    <span>Playlist Parallel Worker Pool</span>
                    <span className="px-1.5 py-0.2 rounded bg-lumina-emerald/20 text-lumina-emerald text-[9px] font-mono font-bold">ZERO DELAY</span>
                  </div>
                  <div className="text-[11px] text-slate-400 max-w-md">
                    Downloads multiple songs simultaneously in the background. Completely eliminates the pause between tracks during playlist downloads.
                  </div>
                </div>
                <span className="font-mono text-sm text-lumina-emerald font-bold">
                  {settings.batchConcurrency || 3}x Parallel
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="6"
                value={settings.batchConcurrency || 3}
                onChange={(e) => handleUpdate({ batchConcurrency: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumina-emerald"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>1 Song (Sequential)</span>
                <span>3 Songs (Optimal)</span>
                <span>6 Songs (Max Bandwidth)</span>
              </div>
            </div>

            {/* IDM Turbo Multi-Connection */}
            <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <span className="text-lumina-cyan font-bold">IDM Turbo Multi-Connection</span>
                    <span className="px-1.5 py-0.2 rounded bg-lumina-cyan/20 text-lumina-cyan text-[9px] font-mono font-bold">16x SPEED</span>
                  </div>
                  <div className="text-[11px] text-slate-500 max-w-md">
                    Splits downloads into concurrent TCP chunks and streams 16 parallel fragments simultaneously, replicating Internet Download Manager (IDM) wire speeds.
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enableTurboMode}
                    onChange={(e) => handleUpdate({ enableTurboMode: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lumina-cyan"></div>
                </label>
              </div>

              {settings.enableTurboMode && (
                <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>Turbo Parallel Connections per Download:</span>
                    <span className="font-mono text-lumina-cyan">{settings.turboConnections || 16} Connections</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="32"
                    step="4"
                    value={settings.turboConnections || 16}
                    onChange={(e) => handleUpdate({ turboConnections: parseInt(e.target.value, 10) })}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumina-cyan"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-slate-500">
                    <span>4 Streams</span>
                    <span>16 Streams (Recommended)</span>
                    <span>32 Streams (Extreme)</span>
                  </div>
                </div>
              )}
            </div>

            {/* BitTorrent Swarm Engine */}
            <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="text-lumina-violet font-bold">BitTorrent P2P Engine</span>
                  <span className="px-1.5 py-0.2 rounded bg-lumina-violet/20 text-lumina-violet text-[9px] font-mono font-bold">50 TRACKERS</span>
                </div>
                <div className="text-[11px] text-slate-500 max-w-md">
                  High-speed peer-to-peer downloading with 50 pre-configured tier-1 public trackers, DHT, PEX, and ARC4 payload encryption.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableBitTorrent}
                  onChange={(e) => handleUpdate({ enableBitTorrent: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lumina-violet"></div>
              </label>
            </div>
          </div>
        )}

        {/* Panel: Storage & USB */}
        {activeSubTab === 'storage' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Removable Drive (Pendrive) Automation</h3>
              <p className="text-xs text-slate-400">
                Automatically detect connected USB drives and route downloads straight to them.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200">Auto-Save to USB Drive</div>
                <div className="text-[11px] text-slate-500">
                  When a pendrive is connected, save directly to it; otherwise fallback to system storage.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoSaveToUsb}
                  onChange={(e) => handleUpdate({ autoSaveToUsb: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lumina-emerald"></div>
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                USB Target Folder Name:
              </label>
              <input
                type="text"
                value={settings.usbFolderName}
                onChange={(e) => handleUpdate({ usbFolderName: e.target.value })}
                placeholder="LuminaMedia"
                className="w-full sm:w-80 px-3.5 py-2.5 rounded-xl glass-input text-xs text-slate-200 focus:outline-none focus:border-lumina-cyan/40"
              />
            </div>

            <div className="pt-2 border-t border-white/[0.06] space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Internal Storage Fallback Destinations</h3>
                <p className="text-xs text-slate-400">
                  Default folders used when no USB drive is connected.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Videos Directory:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={isAndroid ? '/storage/emulated/0/Movies/Lumina' : settings.internalVideoPath}
                      className="w-full px-3 py-2 rounded-xl glass-input text-[11px] text-slate-400 select-all"
                    />
                    {!isAndroid && (
                      <button
                        onClick={() => handleSelectFolder('internalVideoPath')}
                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Folder className="w-3.5 h-3.5" />
                        Browse
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Music Directory:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={isAndroid ? '/storage/emulated/0/Music/Lumina' : settings.internalMusicPath}
                      className="w-full px-3 py-2 rounded-xl glass-input text-[11px] text-slate-400 select-all"
                    />
                    {!isAndroid && (
                      <button
                        onClick={() => handleSelectFolder('internalMusicPath')}
                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Folder className="w-3.5 h-3.5" />
                        Browse
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Panel: Media & Formats */}
        {activeSubTab === 'formats' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Media Quality Preferences</h3>
              <p className="text-xs text-slate-400">
                Pre-configure default resolutions and audio encoders for one-click downloading.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Preferred Video Quality:
                </label>
                <select
                  value={settings.defaultVideoRes}
                  onChange={(e) => handleUpdate({ defaultVideoRes: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-xs text-slate-200 focus:outline-none focus:border-lumina-cyan/40"
                >
                  <option value="max" className="bg-[#171A26] text-white">Maximum Available (4K / 8K UHD)</option>
                  <option value="1080" className="bg-[#171A26] text-white">1080p (Full HD)</option>
                  <option value="720" className="bg-[#171A26] text-white">720p (HD - Faster)</option>
                  <option value="480" className="bg-[#171A26] text-white">480p (Standard Definition)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Preferred Audio Format:
                </label>
                <select
                  value={settings.defaultAudioFormat}
                  onChange={(e) => handleUpdate({ defaultAudioFormat: e.target.value as any })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-xs text-slate-200 focus:outline-none focus:border-lumina-cyan/40"
                >
                  <option value="mp3" className="bg-[#171A26] text-white">MP3 (320 kbps High-Fidelity)</option>
                  <option value="flac" className="bg-[#171A26] text-white">FLAC (Lossless Studio Quality)</option>
                  <option value="opus" className="bg-[#171A26] text-white">OPUS (160 kbps Native Stream)</option>
                  <option value="aac" className="bg-[#171A26] text-white">AAC / M4A (Apple / Mobile)</option>
                  <option value="wav" className="bg-[#171A26] text-white">WAV (Uncompressed PCM)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Panel: Privacy & Anti-Bot Shield */}
        {activeSubTab === 'antibot' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-lumina-emerald" />
                Privacy & Anti-Tracking Shield
              </h3>
              <p className="text-xs text-slate-400">
                Anonymize outgoing network traffic, sanitize tracking identifiers, and protect against rate limits.
              </p>
            </div>

            {/* Anonymity Shield Toggle */}
            <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="text-lumina-emerald font-bold">Request Anonymity & URL Sanitization</span>
                  <span className="px-1.5 py-0.2 rounded bg-lumina-emerald/20 text-lumina-emerald text-[9px] font-mono font-bold">RECOMMENDED</span>
                </div>
                <div className="text-[11px] text-slate-400 max-w-md">
                  Automatically strips user tracking IDs (si, utm_*, fbclid, share_id) from all links, rotates modern Chrome User-Agents, injects DNT and Global Privacy Control headers, and enforces BitTorrent ARC4 encrypted transfers.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.anonymizeRequests}
                  onChange={(e) => handleUpdate({ anonymizeRequests: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-lumina-emerald"></div>
              </label>
            </div>

            {/* Browser Cookie Import */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Import Session Cookies from Local Browser:
              </label>
              <select
                value={settings.browserForCookies}
                onChange={(e) => handleUpdate({ browserForCookies: e.target.value as any })}
                className="w-full sm:w-80 px-3.5 py-2.5 rounded-xl glass-input text-xs text-slate-200 focus:outline-none focus:border-lumina-cyan/40"
              >
                <option value="none" className="bg-[#171A26] text-white">None (Anonymous Extraction)</option>
                <option value="firefox" className="bg-[#171A26] text-white">Firefox (Linux & Windows)</option>
                <option value="chrome" className="bg-[#171A26] text-white">Google Chrome</option>
                <option value="brave" className="bg-[#171A26] text-white">Brave Browser</option>
                <option value="edge" className="bg-[#171A26] text-white">Microsoft Edge</option>
              </select>
              <p className="text-[10px] text-slate-500">
                Allows downloading age-gated media without exposing account credentials or passwords.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-lumina-emerald/5 border border-lumina-emerald/20 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-lumina-emerald flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                Active Privacy & Anti-Flagging Defenses
              </div>
              <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc list-inside">
                <li>Automatic stripping of URL telemetry parameters (si, utm_source, fbclid)</li>
                <li>Chrome 131 header emulation + Do-Not-Track (DNT: 1) & Sec-GPC: 1</li>
                <li>BitTorrent traffic encryption (--bt-require-crypto=true, arc4 min level)</li>
                <li>Multi-source lyrics fallback (LRCLIB + Lyrics.ovh + clean token search)</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
