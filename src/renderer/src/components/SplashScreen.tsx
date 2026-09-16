import React, { useEffect, useState, useRef } from 'react';
import luminaLogo from '../assets/lumina_3d.png';

interface SplashScreenProps {
  onFinish: () => void;
}

// 12 3D Geometric Shards that assemble from deep space into the Lumina Prism
interface ShardConfig {
  id: number;
  startX: number;
  startY: number;
  startZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  width: number;
  height: number;
  clipPath: string;
  gradient: string;
  glow: string;
  delay: number;
}

const SHARDS: ShardConfig[] = [
  // Top apex crystal facets
  {
    id: 1,
    startX: -140, startY: -180, startZ: -320,
    rotX: 65, rotY: -45, rotZ: 25,
    width: 42, height: 55,
    clipPath: 'polygon(50% 0%, 100% 100%, 0% 80%)',
    gradient: 'linear-gradient(135deg, rgba(0,242,254,0.9), rgba(79,70,229,0.7))',
    glow: 'rgba(0,242,254,0.6)',
    delay: 0
  },
  {
    id: 2,
    startX: 160, startY: -160, startZ: -280,
    rotX: -55, rotY: 50, rotZ: -30,
    width: 46, height: 60,
    clipPath: 'polygon(0% 0%, 100% 30%, 50% 100%)',
    gradient: 'linear-gradient(135deg, rgba(157,78,221,0.9), rgba(0,242,254,0.8))',
    glow: 'rgba(157,78,221,0.6)',
    delay: 40
  },
  {
    id: 3,
    startX: 0, startY: -220, startZ: -400,
    rotX: 80, rotY: 0, rotZ: 15,
    width: 38, height: 65,
    clipPath: 'polygon(50% 0%, 100% 70%, 50% 100%, 0% 70%)',
    gradient: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(0,242,254,0.7))',
    glow: 'rgba(255,255,255,0.7)',
    delay: 80
  },
  // Lateral wing crystal facets
  {
    id: 4,
    startX: -220, startY: -20, startZ: -250,
    rotX: 20, rotY: -75, rotZ: -40,
    width: 50, height: 48,
    clipPath: 'polygon(0% 50%, 50% 0%, 100% 50%, 50% 100%)',
    gradient: 'linear-gradient(135deg, rgba(0,242,254,0.85), rgba(16,185,129,0.7))',
    glow: 'rgba(0,242,254,0.5)',
    delay: 60
  },
  {
    id: 5,
    startX: 240, startY: 30, startZ: -300,
    rotX: -25, rotY: 70, rotZ: 35,
    width: 52, height: 45,
    clipPath: 'polygon(10% 0%, 100% 50%, 80% 100%, 0% 60%)',
    gradient: 'linear-gradient(225deg, rgba(247,37,133,0.9), rgba(157,78,221,0.8))',
    glow: 'rgba(247,37,133,0.6)',
    delay: 100
  },
  // Core central prism faces
  {
    id: 6,
    startX: -60, startY: 10, startZ: -180,
    rotX: 30, rotY: -30, rotZ: 10,
    width: 48, height: 56,
    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    gradient: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(0,242,254,0.9))',
    glow: 'rgba(0,242,254,0.8)',
    delay: 120
  },
  {
    id: 7,
    startX: 70, startY: -15, startZ: -190,
    rotX: -30, rotY: 30, rotZ: -15,
    width: 50, height: 54,
    clipPath: 'polygon(20% 0%, 100% 20%, 80% 100%, 0% 80%)',
    gradient: 'linear-gradient(315deg, rgba(157,78,221,0.85), rgba(247,37,133,0.85))',
    glow: 'rgba(157,78,221,0.7)',
    delay: 140
  },
  // Lower pedestal crystal facets
  {
    id: 8,
    startX: -150, startY: 170, startZ: -290,
    rotX: -50, rotY: -40, rotZ: 45,
    width: 44, height: 50,
    clipPath: 'polygon(0% 20%, 80% 0%, 100% 100%, 20% 100%)',
    gradient: 'linear-gradient(135deg, rgba(79,70,229,0.85), rgba(0,242,254,0.75))',
    glow: 'rgba(79,70,229,0.6)',
    delay: 90
  },
  {
    id: 9,
    startX: 170, startY: 180, startZ: -310,
    rotX: 55, rotY: 45, rotZ: -50,
    width: 46, height: 52,
    clipPath: 'polygon(20% 0%, 100% 20%, 70% 100%, 0% 70%)',
    gradient: 'linear-gradient(225deg, rgba(247,37,133,0.8), rgba(0,242,254,0.7))',
    glow: 'rgba(247,37,133,0.5)',
    delay: 110
  },
  {
    id: 10,
    startX: 0, startY: 210, startZ: -240,
    rotX: -70, rotY: 0, rotZ: 20,
    width: 40, height: 58,
    clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
    gradient: 'linear-gradient(0deg, rgba(0,242,254,0.9), rgba(157,78,221,0.7))',
    glow: 'rgba(0,242,254,0.7)',
    delay: 130
  },
  // Radial orbiting light sparkles
  {
    id: 11,
    startX: -90, startY: -90, startZ: -120,
    rotX: 45, rotY: 45, rotZ: 45,
    width: 22, height: 22,
    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    gradient: 'radial-gradient(circle, #ffffff 30%, rgba(0,242,254,0.8) 100%)',
    glow: 'rgba(255,255,255,0.9)',
    delay: 150
  },
  {
    id: 12,
    startX: 95, startY: 85, startZ: -130,
    rotX: -45, rotY: -45, rotZ: -45,
    width: 20, height: 20,
    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    gradient: 'radial-gradient(circle, #ffffff 30%, rgba(247,37,133,0.8) 100%)',
    glow: 'rgba(247,37,133,0.9)',
    delay: 170
  }
];

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  // Animation Phases:
  // 0: Void (Pitch dark inception)
  // 1: Shards emerging & spiraling inward in 3D
  // 2: Magnetic lock & fusion impact flash (audio chime strikes!)
  // 3: Full 3D Lumina icon radiance & laser typography sweep
  // 4: Seamless fadeout transition
  const [phase, setPhase] = useState<number>(0);
  const [statusText, setStatusText] = useState('Initializing quantum core...');
  const [progress, setProgress] = useState(5);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Synthesize futuristic harmonic startup chime using Web Audio API
  const playStartupChime = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // 1. Cinematic Sub-bass Swell
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(46, now); // Low F#
      subOsc.frequency.exponentialRampToValueAtTime(68, now + 0.8);
      subGain.gain.setValueAtTime(0.001, now);
      subGain.gain.linearRampToValueAtTime(0.35, now + 0.35);
      subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      subOsc.connect(subGain);
      subGain.connect(ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 1.25);

      // 2. Tactile Shard Lock Snap (Resonant click at 0.75s)
      const snapTime = now + 0.75;
      const snapOsc = ctx.createOscillator();
      const snapGain = ctx.createGain();
      const snapFilter = ctx.createBiquadFilter();
      snapOsc.type = 'triangle';
      snapOsc.frequency.setValueAtTime(1400, snapTime);
      snapOsc.frequency.exponentialRampToValueAtTime(180, snapTime + 0.08);
      snapFilter.type = 'bandpass';
      snapFilter.frequency.setValueAtTime(1200, snapTime);
      snapFilter.Q.setValueAtTime(4, snapTime);
      snapGain.gain.setValueAtTime(0.4, snapTime);
      snapGain.gain.exponentialRampToValueAtTime(0.0001, snapTime + 0.09);
      snapOsc.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(ctx.destination);
      snapOsc.start(snapTime);
      snapOsc.stop(snapTime + 0.1);

      // 3. Shimmering Crystal Harmonic Chords (Maj9 suspended harmony)
      const chordFrequencies = [
        261.63, // C4
        392.00, // G4
        523.25, // C5
        659.25, // E5
        987.77, // B5
        1174.66 // D6
      ];

      chordFrequencies.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, snapTime + idx * 0.015);

        // Soft shimmer detune
        osc.detune.setValueAtTime((idx - 2.5) * 6, snapTime);

        // Bell envelope
        gain.gain.setValueAtTime(0.001, snapTime + idx * 0.015);
        gain.gain.linearRampToValueAtTime(0.18 / (idx * 0.4 + 1), snapTime + idx * 0.015 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, snapTime + 1.4 + idx * 0.1);

        if (pan) {
          pan.pan.setValueAtTime((idx / 5) * 1.4 - 0.7, snapTime);
          osc.connect(gain);
          gain.connect(pan);
          pan.connect(ctx.destination);
        } else {
          osc.connect(gain);
          gain.connect(ctx.destination);
        }

        osc.start(snapTime + idx * 0.015);
        osc.stop(snapTime + 1.6);
      });
    } catch (err) {
      console.warn('Web Audio synthesis bypassed or muted:', err);
    }
  };

  useEffect(() => {
    // Phase 1: Inception & Shards emerge (100ms)
    const t1 = setTimeout(() => {
      setPhase(1);
      setStatusText('Assembling kinetic crystal core...');
      setProgress(30);
    }, 120);

    // Audio chime fires at 150ms to align with lock snap at 850ms
    const tAudio = setTimeout(() => {
      playStartupChime();
    }, 150);

    // Phase 2: Lock & Fusion impact (850ms)
    const t2 = setTimeout(() => {
      setPhase(2);
      setStatusText('Aligning IDM Turbo & BitTorrent matrix...');
      setProgress(68);
    }, 850);

    // Phase 3: Full Icon Radiance & Engine Ready (1400ms)
    const t3 = setTimeout(() => {
      setPhase(3);
      setStatusText('Lumina 2.0 Engine online & ready');
      setProgress(100);
    }, 1450);

    // Phase 4: Seamless transition out (2100ms)
    const t4 = setTimeout(() => {
      onFinish();
    }, 2200);

    return () => {
      clearTimeout(t1);
      clearTimeout(tAudio);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#060709] select-none overflow-hidden">
      {/* Dynamic Deep Space Ambient Glow */}
      <div 
        className={`absolute w-[600px] h-[600px] rounded-full transition-all duration-1000 pointer-events-none ${
          phase >= 2 
            ? 'bg-gradient-to-tr from-[#9d4edd]/30 via-[#00f2fe]/25 to-transparent blur-[120px] scale-125 opacity-100'
            : phase === 1
            ? 'bg-gradient-to-tr from-[#9d4edd]/15 via-[#00f2fe]/10 to-transparent blur-[80px] scale-90 opacity-60'
            : 'opacity-0 scale-50'
        }`} 
      />

      {/* Fusion Impact Shockwave Ring */}
      {phase >= 2 && (
        <div className="absolute w-72 h-72 rounded-full border border-cyan-400/60 pointer-events-none animate-ping opacity-35" />
      )}

      {/* 3D Perspective Stage */}
      <div className="relative z-10 flex flex-col items-center">
        <div 
          className="relative w-44 h-44 flex items-center justify-center"
          style={{ perspective: '1100px', transformStyle: 'preserve-3d' }}
        >
          {/* Phase 1 & 2: Assembling 3D Shards */}
          <div 
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {SHARDS.map((shard) => {
              // During phase 0: completely dispersed in void
              // During phase 1: hovering / pulling inward
              // During phase 2+: fully locked at center (0,0,0) with 0 rotation
              const isLocked = phase >= 2;
              const isEmerging = phase >= 1;

              const currentX = isLocked ? 0 : isEmerging ? shard.startX * 0.4 : shard.startX;
              const currentY = isLocked ? 0 : isEmerging ? shard.startY * 0.4 : shard.startY;
              const currentZ = isLocked ? 0 : isEmerging ? shard.startZ * 0.4 : shard.startZ;

              const currentRotX = isLocked ? 0 : isEmerging ? shard.rotX * 0.4 : shard.rotX;
              const currentRotY = isLocked ? 0 : isEmerging ? shard.rotY * 0.4 : shard.rotY;
              const currentRotZ = isLocked ? 0 : isEmerging ? shard.rotZ * 0.4 : shard.rotZ;

              const opacity = isLocked ? 0 : isEmerging ? 0.95 : 0;
              const scale = isLocked ? 0.2 : isEmerging ? 1 : 0.4;

              return (
                <div
                  key={shard.id}
                  className="absolute transition-all duration-700 ease-out"
                  style={{
                    width: `${shard.width}px`,
                    height: `${shard.height}px`,
                    clipPath: shard.clipPath,
                    background: shard.gradient,
                    boxShadow: `0 0 24px ${shard.glow}`,
                    opacity,
                    transform: `translate3d(${currentX}px, ${currentY}px, ${currentZ}px) rotateX(${currentRotX}deg) rotateY(${currentRotY}deg) rotateZ(${currentRotZ}deg) scale(${scale})`,
                    transitionDelay: `${isLocked ? 0 : shard.delay}ms`
                  }}
                />
              );
            })}
          </div>

          {/* Phase 2+: Fully Assembled Solid 3D Lumina Prism Icon */}
          <div
            className={`relative flex items-center justify-center transition-all duration-700 ${
              phase >= 2
                ? 'opacity-100 scale-100 filter drop-shadow-[0_0_35px_rgba(0,242,254,0.7)]'
                : 'opacity-0 scale-75'
            }`}
          >
            {/* Core Radial Backlight */}
            <div className="absolute w-36 h-36 rounded-full bg-gradient-to-tr from-[#9d4edd] via-[#00f2fe] to-white/40 blur-2xl opacity-60 animate-pulse" />
            
            <img
              src={luminaLogo}
              alt="Lumina 2.0 3D Prism"
              className="w-32 h-32 object-contain relative z-10 filter drop-shadow-[0_4px_25px_rgba(0,242,254,0.85)]"
            />
          </div>
        </div>

        {/* Branding Typography & Version 2.0 Tag */}
        <div 
          className={`text-center mt-6 space-y-1 transition-all duration-700 ${
            phase >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="flex items-center justify-center space-x-2">
            <h1 className="text-3xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-[#00f2fe] to-[#9d4edd]">
              LUMINA
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-cyan-500/20 text-[#00f2fe] border border-cyan-400/30">
              2.0
            </span>
          </div>
          <p className="text-[11px] font-semibold tracking-[0.25em] text-slate-400 uppercase">
            Universal Media & Multi-Part Repack Suite
          </p>
        </div>

        {/* Status Progress Track */}
        <div 
          className={`w-72 space-y-2 mt-6 transition-all duration-500 ${
            phase >= 1 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="w-full h-1.5 bg-white/[0.08] rounded-full overflow-hidden p-0.5 border border-white/5">
            <div
              className="h-full bg-gradient-to-r from-[#9d4edd] via-[#00f2fe] to-white rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(0,242,254,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1">
            <span className="truncate">{statusText}</span>
            <span className="text-cyan-400 font-bold ml-2">{progress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
