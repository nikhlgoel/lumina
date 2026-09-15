import React, { useEffect, useState } from 'react';
import luminaLogo from '../assets/lumina_3d.png';

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const [statusText, setStatusText] = useState('Initializing Lumina...');
  const [progress, setProgress] = useState(10);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setStatusText('Probing FFmpeg hardware muxer...');
      setProgress(40);
    }, 400);

    const t2 = setTimeout(() => {
      setStatusText('Verifying media extraction engine...');
      setProgress(75);
    }, 850);

    const t3 = setTimeout(() => {
      setStatusText('Scanning storage & removable drives...');
      setProgress(95);
    }, 1250);

    const t4 = setTimeout(() => {
      setStatusText('Ready for media harvesting');
      setProgress(100);
    }, 1600);

    const t5 = setTimeout(() => {
      onFinish();
    }, 1900);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#08090D] select-none">
      {/* Ambient background glow */}
      <div className="absolute w-96 h-96 rounded-full bg-gradient-to-tr from-lumina-violet/20 via-lumina-cyan/20 to-transparent blur-3xl pointer-events-none animate-pulse-slow" />

      <div className="relative z-10 flex flex-col items-center space-y-6">
        {/* 3D Crystal Prism Logo */}
        <div className="relative w-32 h-32 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-lumina-violet via-lumina-cyan to-transparent blur-2xl opacity-50 animate-pulse" />
          <img
            src={luminaLogo}
            alt="Lumina 3D Logo"
            className="w-28 h-28 object-contain relative z-10 filter drop-shadow-[0_0_20px_rgba(0,242,254,0.6)] animate-pulse-slow"
          />
        </div>

        {/* Branding Typography */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
            LUMINA
          </h1>
          <p className="text-[11px] font-medium tracking-widest text-slate-500 uppercase">
            Universal Media Downloader & Player
          </p>
        </div>

        {/* Boot Status & Progress */}
        <div className="w-64 space-y-2 pt-2">
          <div className="w-full h-1 bg-white/[0.08] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-lumina-violet to-lumina-cyan transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[10px] text-center font-mono text-slate-400 truncate">
            {statusText}
          </div>
        </div>
      </div>
    </div>
  );
};
