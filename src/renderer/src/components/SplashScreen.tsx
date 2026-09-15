import React, { useEffect, useState } from 'react';

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
        {/* Animated Vector Logo */}
        <div className="relative w-28 h-28 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-lumina-violet to-lumina-cyan blur-xl opacity-40 animate-pulse" />
          
          <svg className="w-24 h-24 relative" viewBox="0 0 512 512" fill="none">
            <circle cx="256" cy="256" r="230" stroke="url(#glassRim)" strokeWidth="4" />
            <polygon
              points="256,96 390,173 390,327 256,404 122,327 122,173"
              stroke="url(#prismGrad)"
              strokeWidth="6"
              strokeLinejoin="round"
              className="animate-spin-slow origin-center opacity-90"
            />
            <path
              d="M 256 96 C 330 140 370 200 350 280 C 335 340 280 370 220 350 C 170 330 160 270 190 220 C 215 180 260 180 280 210"
              stroke="url(#prismGrad)"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="256" cy="256" r="10" fill="#00F2FE" />
            <defs>
              <linearGradient id="prismGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#9D4EDD" />
                <stop offset="100%" stopColor="#00F2FE" />
              </linearGradient>
              <linearGradient id="glassRim" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#00F2FE" stopOpacity="0.2" />
              </linearGradient>
            </defs>
          </svg>
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
