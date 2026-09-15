import React, { useEffect, useRef } from 'react';
import { useLuminaStore } from '../store/useLuminaStore';

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

    // Three ambient nodes with sinusoidal drift
    let t = 0;

    const render = () => {
      t += 0.004;

      ctx.clearRect(0, 0, width, height);

      // Node 1: Cyan / Aqua
      const x1 = width * 0.3 + Math.sin(t * 1.2) * (width * 0.15);
      const y1 = height * 0.35 + Math.cos(t * 0.9) * (height * 0.12);
      const r1 = Math.min(width, height) * 0.45;
      const grad1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, r1);
      grad1.addColorStop(0, 'rgba(0, 242, 254, 0.08)');
      grad1.addColorStop(0.5, 'rgba(0, 242, 254, 0.02)');
      grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, width, height);

      // Node 2: Electric Violet / Purple
      const x2 = width * 0.75 + Math.cos(t * 1.1) * (width * 0.18);
      const y2 = height * 0.65 + Math.sin(t * 0.8) * (height * 0.15);
      const r2 = Math.min(width, height) * 0.5;
      const grad2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, r2);
      grad2.addColorStop(0, 'rgba(157, 78, 221, 0.09)');
      grad2.addColorStop(0.6, 'rgba(121, 40, 202, 0.025)');
      grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, width, height);

      // Node 3: Deep Indigo / Magenta pulse
      const x3 = width * 0.5 + Math.sin(t * 0.7) * (width * 0.12);
      const y3 = height * 0.8 + Math.cos(t * 1.3) * (height * 0.1);
      const r3 = Math.min(width, height) * 0.4;
      const grad3 = ctx.createRadialGradient(x3, y3, 0, x3, y3, r3);
      grad3.addColorStop(0, 'rgba(247, 37, 133, 0.05)');
      grad3.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad3;
      ctx.fillRect(0, 0, width, height);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, downloads.length, settings?.ambientShader]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-80"
    />
  );
};
