import { useState } from 'react';
import { Film, Music } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Stable, pleasant two-tone gradient derived from a string, used when media has no artwork. */
export function fallbackGradient(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 40 + (Math.abs(h >> 8) % 60)) % 360;
  return `linear-gradient(135deg, oklch(62% 0.12 ${hue}), oklch(38% 0.09 ${hue2}))`;
}

export function Artwork({ src, seed, kind = 'audio', className, rounded = 'rounded-lg' }: {
  src: string | null; seed: string; kind?: 'audio' | 'video'; className?: string; rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;
  return (
    <div className={cn('relative shrink-0 overflow-hidden bg-sunken', rounded, className)} style={showImage ? undefined : { background: fallbackGradient(seed) }}>
      {showImage ? (
        <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-white/70 [&_svg]:size-[38%]">{kind === 'video' ? <Film /> : <Music />}</div>
      )}
    </div>
  );
}
