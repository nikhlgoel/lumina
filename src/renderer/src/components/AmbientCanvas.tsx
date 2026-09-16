import React, { useEffect, useRef } from 'react';
import { useLuminaStore } from '../store/useLuminaStore';

interface Palette {
  c1: string;
  c2: string;
  c3: string;
}

const THEME_PALETTES: Record<string, { dark: Palette; light: Palette }> = {
  onyx: {
    dark: { c1: 'rgba(0, 242, 254, 0.08)', c2: 'rgba(157, 78, 221, 0.09)', c3: 'rgba(247, 37, 133, 0.05)' },
    light: { c1: 'rgba(0, 180, 216, 0.08)', c2: 'rgba(147, 51, 234, 0.07)', c3: 'rgba(236, 72, 153, 0.05)' }
  },
  cyber: {
    dark: { c1: 'rgba(255, 230, 0, 0.07)', c2: 'rgba(247, 37, 133, 0.09)', c3: 'rgba(0, 242, 254, 0.07)' },
    light: { c1: 'rgba(234, 179, 8, 0.08)', c2: 'rgba(219, 39, 119, 0.07)', c3: 'rgba(6, 182, 212, 0.06)' }
  },
  arctic: {
    dark: { c1: 'rgba(56, 189, 248, 0.08)', c2: 'rgba(129, 140, 248, 0.08)', c3: 'rgba(45, 212, 191, 0.06)' },
    light: { c1: 'rgba(14, 165, 233, 0.08)', c2: 'rgba(99, 102, 241, 0.07)', c3: 'rgba(20, 184, 166, 0.05)' }
  },
  teal: {
    dark: { c1: 'rgba(20, 184, 166, 0.09)', c2: 'rgba(16, 185, 129, 0.08)', c3: 'rgba(6, 182, 212, 0.07)' },
    light: { c1: 'rgba(13, 148, 136, 0.08)', c2: 'rgba(5, 150, 105, 0.07)', c3: 'rgba(8, 145, 178, 0.06)' }
  },
  sunset: {
    dark: { c1: 'rgba(255, 107, 107, 0.09)', c2: 'rgba(255, 159, 67, 0.08)', c3: 'rgba(157, 78, 221, 0.07)' },
    light: { c1: 'rgba(239, 68, 68, 0.08)', c2: 'rgba(249, 115, 22, 0.07)', c3: 'rgba(168, 85, 247, 0.06)' }
  },
  amethyst: {
    dark: { c1: 'rgba(132, 94, 194, 0.10)', c2: 'rgba(195, 74, 240, 0.08)', c3: 'rgba(255, 150, 240, 0.06)' },
    light: { c1: 'rgba(124, 58, 237, 0.09)', c2: 'rgba(168, 85, 247, 0.07)', c3: 'rgba(236, 72, 153, 0.05)' }
  }
};

export const AmbientCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { isPlaying, downloads, settings } = useLuminaStore();

  useEffect(() => {
    if (settings && !settings.ambientShader) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    const themeKey = settings?.theme || 'onyx';
    const modeKey = settings?.colorMode || 'dark';
    const palette = (THEME_PALETTES[themeKey] || THEME_PALETTES.onyx)[modeKey];

    // Three ambient nodes with sinusoidal drift
    let t = 0;

    const render = () => {
      t += 0.004;

      ctx.clearRect(0, 0, width, height);

      // Node 1: Primary Accent
      const x1 = width * 0.3 + Math.sin(t * 1.2) * (width * 0.15);
      const y1 = height * 0.35 + Math.cos(t * 0.9) * (height * 0.12);
      const r1 = Math.min(width, height) * 0.45;
      const grad1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, r1);
      grad1.addColorStop(0, palette.c1);
      grad1.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, width, height);

      // Node 2: Secondary Tone
      const x2 = width * 0.75 + Math.cos(t * 1.1) * (width * 0.18);
      const y2 = height * 0.65 + Math.sin(t * 0.8) * (height * 0.15);
      const r2 = Math.min(width, height) * 0.5;
      const grad2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, r2);
      grad2.addColorStop(0, palette.c2);
      grad2.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, width, height);

      // Node 3: Deep harmonic pulse
      const x3 = width * 0.5 + Math.sin(t * 0.7) * (width * 0.12);
      const y3 = height * 0.8 + Math.cos(t * 1.3) * (height * 0.1);
      const r3 = Math.min(width, height) * 0.4;
      const grad3 = ctx.createRadialGradient(x3, y3, 0, x3, y3, r3);
      grad3.addColorStop(0, palette.c3);
      grad3.addColorStop(0.6, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad3;
      ctx.fillRect(0, 0, width, height);

      animationFrameId = requestAnimationFrame(render);
    };

    let isLoopRunning = false;

    const startLoop = () => {
      if (isLoopRunning) return;
      isLoopRunning = true;
      render();
    };

    const stopLoop = () => {
      if (!isLoopRunning) return;
      isLoopRunning = false;
      cancelAnimationFrame(animationFrameId);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Only run if visible
    if (!document.hidden) {
      startLoop();
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopLoop();
    };
  }, [isPlaying, downloads.length, settings?.ambientShader, settings?.theme, settings?.colorMode]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-80"
    />
  );
};
