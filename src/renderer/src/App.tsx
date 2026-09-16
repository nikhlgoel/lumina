import React, { useEffect, useState } from 'react';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { AmbientCanvas } from './components/AmbientCanvas';
import { Omnibox } from './components/Omnibox';
import { MediaInspector } from './components/MediaInspector';
import { DownloadQueue } from './components/DownloadQueue';
import { MiniPlayer } from './components/MiniPlayer';
import { MusicHub } from './components/MusicHub';
import { LocalLibrary } from './components/LocalLibrary';
import { SettingsModal } from './components/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import { LyricsView } from './components/LyricsView';
import { useLuminaStore } from './store/useLuminaStore';

export const App: React.FC = () => {
  const { 
    activeTab, 
    initialize, 
    inspectUrl, 
    clearInspectedMedia, 
    togglePlayPause, 
    currentPlayingTrack, 
    setUrlInput,
    isLyricsOpen,
    setLyricsOpen,
    toggleLyrics
  } = useLuminaStore();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    initialize();

    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Escape: Dismiss active lyrics or preview
      if (e.key === 'Escape') {
        if (isLyricsOpen) {
          setLyricsOpen(false);
          return;
        }
        clearInspectedMedia();
      }

      // 'L' key: Toggle lyrics if not typing
      if ((e.key === 'l' || e.key === 'L') && !isInputFocused && currentPlayingTrack) {
        e.preventDefault();
        toggleLyrics();
      }

      // Space: Toggle in-app player play/pause if not typing
      if (e.code === 'Space' && !isInputFocused && currentPlayingTrack) {
        e.preventDefault();
        togglePlayPause();
      }

      // Ctrl+V or Cmd+V anywhere outside input: Auto-paste and inspect
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isInputFocused) {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().startsWith('http')) {
            setUrlInput(text.trim());
            inspectUrl(text.trim());
          }
        } catch (err) {}
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [initialize, inspectUrl, clearInspectedMedia, togglePlayPause, currentPlayingTrack, setUrlInput, isLyricsOpen, setLyricsOpen, toggleLyrics]);

  return (
    <div className="relative w-screen h-screen flex flex-col bg-lumina-dark text-slate-100 overflow-hidden font-sans">
      {/* Dynamic Ambient Background Canvas */}
      <AmbientCanvas />

      {/* Splash Screen Bootloader */}
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}

      {/* Custom Window Titlebar */}
      <Titlebar />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Left Navigation Sidebar */}
        <Sidebar />

        {/* Dynamic Center Stage */}
        <main className="flex-1 h-full overflow-y-auto p-6 space-y-6">
          {activeTab === 'downloader' && (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Omnibox / Link input */}
              <Omnibox />

              {/* Inspected Media Matrix */}
              <MediaInspector />

              {/* Real-time Downloads Queue */}
              <DownloadQueue />
            </div>
          )}

          {activeTab === 'music' && (
            <div className="max-w-5xl mx-auto">
              <MusicHub />
            </div>
          )}

          {activeTab === 'library' && (
            <div className="max-w-5xl mx-auto">
              <LocalLibrary />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-4xl mx-auto">
              <SettingsModal />
            </div>
          )}
        </main>
      </div>

      {/* Full-Stage Immersive Synced Lyrics Overlay */}
      <LyricsView />

      {/* Persistent Docked Audio Player */}
      <MiniPlayer />
    </div>
  );
};

export default App;
