import { useState } from 'react';
import { Film, Music } from 'lucide-react';
import { gradientCss } from '@core/coverArt';
import { cn } from '@/lib/cn';

/**
 * Stable, pleasant two-tone gradient derived from a string, used when media has no artwork.
 *
 * The maths lives in @core/coverArt because the main process rasterises the very same gradient when
 * it writes artwork into a file — so what a TV shows is exactly what was on screen here.
 */
export const fallbackGradient = gradientCss;

export function Artwork({ src, seed, kind = 'audio', className, rounded = 'rounded-lg', fit = 'cover', style, onRatio }: {
  src: string | null; seed: string; kind?: 'audio' | 'video'; className?: string; rounded?: string;
  /** `cover` fills the box and crops; `contain` shows the whole picture. Big covers want `contain`. */
  fit?: 'cover' | 'contain';
  style?: React.CSSProperties;
  /** Reports width/height once the picture has loaded, so a caller can size its box to the picture. */
  onRatio?: (ratio: number) => void;
}) {
  // Which URL failed, rather than a bare "it failed": a row reused for a different item (or the
  // same item re-requested at another size) would otherwise keep showing the placeholder for a
  // picture that loads perfectly well.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src && failedSrc !== src;
  return (
    <div className={cn('relative shrink-0 overflow-hidden bg-sunken', rounded, className)} style={showImage ? style : { ...style, background: fallbackGradient(seed) }}>
      {showImage ? (
        <img
          src={src} alt="" draggable={false} loading="lazy" onError={() => setFailedSrc(src)}
          onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (onRatio && w > 0 && h > 0) onRatio(w / h); }}
          className={fit === 'contain' ? 'size-full object-contain' : 'size-full object-cover'}
        />
      ) : (
        <div className="grid size-full place-items-center text-white/70 [&_svg]:size-[38%]">{kind === 'video' ? <Film /> : <Music />}</div>
      )}
    </div>
  );
}
