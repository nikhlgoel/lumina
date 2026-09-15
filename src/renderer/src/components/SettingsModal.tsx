import React, { useState } from 'react';
import { 
  Settings2, 
  HardDrive, 
  Film, 
  Cpu, 
  ShieldCheck, 
  Folder, 
  Check, 
  Sparkles 
} from 'lucide-react';
import { useLuminaStore } from '../store/useLuminaStore';

export const SettingsModal: React.FC = () => {
  const { settings, saveSettings } = useLuminaStore();
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'storage' | 'formats' | 'performance' | 'antibot'>('storage');
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
            Customize storage destinations, auto-routing, download defaults, and anti-bot preferences.
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-lumina-emerald/15 text-lumina-emerald border border-lumina-emerald/30 text-xs font-semibold animate-in fade-in">
            <Check className="w-3.5 h-3.5" />
            <span>Settings Saved</span>
          </div>
        )}
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-2xl bg-black/40 border border-white/[0.06] w-fit">
        {[
          { id: 'storage' as const, label: 'Storage & USB', icon: HardDrive },
          { id: 'formats' as const, label: 'Media & Quality', icon: Film },
          { id: 'general' as const, label: 'Interface & Visuals', icon: Sparkles },
          { id: 'performance' as const, label: 'Performance', icon: Cpu },
          { id: 'antibot' as const, label: 'Anti-Bot Shield', icon: ShieldCheck }
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
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
      <div className="p-5 rounded-3xl glass-panel border border-white/[0.08] space-y-5">
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
                className="w-full sm:w-80 px-3.5 py-2.5 rounded-xl glass-input text-xs text-slate-100 focus:outline-none focus:border-lumina-cyan/40"
              />
              <p className="text-[10px] text-slate-500">
                Created automatically on your USB drive (e.g. /LuminaMedia/Videos and /LuminaMedia/Music).
              </p>
            </div>

            <div className="pt-2 border-t border-white/[0.04] space-y-3">
              <h4 className="text-xs font-bold text-slate-200">Internal Storage Fallback Paths</h4>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400">Default Videos Folder:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={settings.internalVideoPath}
                    className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs text-slate-300 font-mono"
                  />
                  <button
                    onClick={() => handleSelectFolder('internalVideoPath')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-card text-xs text-slate-200 hover:text-white"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Change</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400">Default Music Folder:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={settings.internalMusicPath}
                    className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs text-slate-300 font-mono"
                  />
                  <button
                    onClick={() => handleSelectFolder('internalMusicPath')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-card text-xs text-slate-200 hover:text-white"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Change</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Panel: Media & Quality */}
        {activeSubTab === 'formats' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Default Quality Preferences</h3>
              <p className="text-xs text-slate-400">
                Choose the default resolution and audio format to pre-select for links.
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
                  <option value="max" className="bg-[#171A26] text-white">Maximum Available (Up to 8K/4K 60fps)</option>
                  <option value="1080p" className="bg-[#171A26] text-white">1080p Full HD</option>
                  <option value="720p" className="bg-[#171A26] text-white">720p HD</option>
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

        {/* Panel: Interface & Visuals */}
        {activeSubTab === 'general' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Interface & Motion System</h3>
              <p className="text-xs text-slate-400">
                Configure ambient canvas background effects and glass blur intensity.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-black/30 border border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200">Interactive Ambient Backdrop</div>
                <div className="text-[11px] text-slate-500">
                  60fps floating ambient gradient canvas reacting to music and network downloads.
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
        )}

        {/* Panel: Performance */}
        {activeSubTab === 'performance' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Performance & Network Limits</h3>
              <p className="text-xs text-slate-400">
                Manage concurrency and hardware acceleration for FFmpeg.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-300">
                <span>Max Concurrent Downloads:</span>
                <span className="font-mono text-lumina-cyan">{settings.maxConcurrentDownloads} tasks</span>
              </div>
              <input
                type="range"
                min="1"
                max="6"
                value={settings.maxConcurrentDownloads}
                onChange={(e) => handleUpdate({ maxConcurrentDownloads: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumina-cyan"
              />
              <p className="text-[10px] text-slate-500">
                Keeping concurrency at 2-3 avoids platform IP rate limits and maximizes single-file speed.
              </p>
            </div>
          </div>
        )}

        {/* Panel: Anti-Bot Shield */}
        {activeSubTab === 'antibot' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Anti-Bot & Anti-Flagging Shield</h3>
              <p className="text-xs text-slate-400">
                Protect your connection against rate limits, download age-restricted media, and bypass 429 errors.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Import Session Cookies from Local Browser:
              </label>
              <select
                value={settings.browserForCookies}
                onChange={(e) => handleUpdate({ browserForCookies: e.target.value as any })}
                className="w-full sm:w-80 px-3.5 py-2.5 rounded-xl glass-input text-xs text-slate-200 focus:outline-none focus:border-lumina-cyan/40"
              >
                <option value="none" className="bg-[#171A26] text-white">None (Standard Extraction)</option>
                <option value="firefox" className="bg-[#171A26] text-white">Firefox (Recommended for Fedora)</option>
                <option value="chrome" className="bg-[#171A26] text-white">Google Chrome</option>
                <option value="brave" className="bg-[#171A26] text-white">Brave Browser</option>
                <option value="edge" className="bg-[#171A26] text-white">Microsoft Edge</option>
              </select>
              <p className="text-[10px] text-slate-500">
                Seamlessly allows downloading age-gated videos and premium streams safely without saving your passwords.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-lumina-cyan/5 border border-lumina-cyan/20 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-lumina-cyan flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                Active Protections Enabled
              </div>
              <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc list-inside">
                <li>Client emulation: cycling iOS and Web embedded player endpoints</li>
                <li>Lossless FFmpeg dual-stream DASH muxing (no quality downgrade)</li>
                <li>NVMe Staging buffer: protection against USB flash drive disconnections</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
