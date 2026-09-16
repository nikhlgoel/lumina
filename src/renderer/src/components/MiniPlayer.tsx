import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Music, SkipForward, SkipBack, Mic2 } from 'lucide-react';
import clsx from 'clsx';
import { useLuminaStore } from '../store/useLuminaStore';

export const MiniPlayer: React.FC = () => {
  const { 
    currentPlayingTrack, 
    isPlaying, 
    togglePlayPause, 
    audioStreamUrl, 
    volume, 
    setVolume,
    seekTarget,
    clearSeekTarget,
    updatePlaybackTime,
    toggleLyrics,
    isLyricsOpen
  } = useLuminaStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Web Audio Context & Analyzer
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audioStreamUrl) {
      audio.src = audioStreamUrl;
      audio.play().catch((e) => console.warn('Autoplay blocked:', e));
    }
  }, [audioStreamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // Handle external seek requests (e.g. clicking a lyric line)
  useEffect(() => {
    if (seekTarget !== null && audioRef.current) {
      audioRef.current.currentTime = seekTarget;
      setCurrentTime(seekTarget);
      clearSeekTarget();
    }
  }, [seekTarget, clearSeekTarget]);

  // Connect Web Audio API Analyser
  const setupAudioContext = () => {
    if (!audioCtxRef.current && audioRef.current) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        sourceRef.current = source;
      } catch (e) {
        console.warn('Web Audio API not supported in this context:', e);
      }
    }
  };

  // Draw Frequency Spectrum Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const renderWave = () => {
      const analyser = analyserRef.current;
      if (analyser && isPlaying) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height;
          const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
          gradient.addColorStop(0, '#9D4EDD');
          gradient.addColorStop(1, '#00F2FE');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
        }
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      animId = requestAnimationFrame(renderWave);
    };

    renderWave();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  if (!currentPlayingTrack) return null;

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const cur = audioRef.current.currentTime;
      const dur = audioRef.current.duration || 0;
      setCurrentTime(cur);
      setDuration(dur);
      updatePlaybackTime(cur, dur);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = parseFloat(e.target.value);
    setCurrentTime(target);
    if (audioRef.current) {
      audioRef.current.currentTime = target;
      updatePlaybackTime(target, duration);
    }
  };

  const formatSec = (sec: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? `0${s}` : s}`;
  };

  return (
    <div className="h-16 w-full glass-panel border-t border-white/[0.08] px-4 flex items-center justify-between z-30 select-none shadow-2xl">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onPlay={setupAudioContext}
        onEnded={() => togglePlayPause()}
      />

      {/* Left: Track Details */}
      <div className="flex items-center gap-3 w-1/4 min-w-[180px]">
        <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/40 border border-white/10 shrink-0">
          {currentPlayingTrack.thumbnail ? (
            <img src={currentPlayingTrack.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-lumina-violet">
              <Music className="w-5 h-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-100 truncate">
            {currentPlayingTrack.title}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            {currentPlayingTrack.artist}
          </div>
        </div>
      </div>

      {/* Center: Controls, Scrubber & Waveform */}
      <div className="flex flex-col items-center justify-center gap-1 flex-1 max-w-xl px-4">
        <div className="flex items-center gap-4">
          <button className="text-slate-400 hover:text-white transition-colors">
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={togglePlayPause}
            className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md shadow-white/20"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button className="text-slate-400 hover:text-white transition-colors">
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <div className="w-full flex items-center gap-2 text-[10px] font-mono text-slate-400">
          <span>{formatSec(currentTime)}</span>
          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumina-cyan"
            />
          </div>
          <span>{formatSec(duration)}</span>
        </div>
      </div>

      {/* Right: Waveform visualizer, Lyrics Button & Volume */}
      <div className="flex items-center justify-end gap-3 w-1/4 min-w-[210px]">
        {/* Lyrics Button */}
        <button
          onClick={toggleLyrics}
          title="Toggle Lyrics (L)"
          className={clsx(
            "px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95 border",
            isLyricsOpen 
              ? "bg-lumina-cyan/20 text-lumina-cyan border-lumina-cyan/50 shadow-lumina-cyan/20"
              : "text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border-white/10"
          )}
        >
          <Mic2 className={clsx("w-3.5 h-3.5", isLyricsOpen && "animate-pulse text-lumina-cyan")} />
          <span className="text-[11px] font-medium">Lyrics</span>
        </button>

        {/* Spectrum Waveform Canvas */}
        <canvas
          ref={canvasRef}
          width={65}
          height={22}
          className="rounded opacity-80 shrink-0"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              setVolume(parseFloat(e.target.value));
              setIsMuted(false);
            }}
            className="w-16 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumina-violet"
          />
        </div>
      </div>
    </div>
  );
};
