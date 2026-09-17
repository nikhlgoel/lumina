export type RGB = [number, number, number];

const FALLBACK: RGB[] = [[0.42, 0.3, 1], [1, 0.48, 0.35], [0.12, 0.78, 0.7]];
const cache = new Map<string, RGB[]>();

function hashPalette(seed: string): RGB[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const hue = (Math.abs(h) % 360) / 360;
  return [0, 0.12, 0.55].map((o) => hslToRgb((hue + o) % 1, 0.62, 0.52));
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/**
 * Three representative colors from an image, as 0–1 RGB.
 * Buckets pixels by hue and picks the most common vivid buckets so backgrounds don't turn muddy.
 */
export async function extractPalette(src: string | null, seed: string): Promise<RGB[]> {
  const key = src ?? `seed:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!src) {
    const p = hashPalette(seed);
    cache.set(key, p);
    return p;
  }

  const palette = await new Promise<RGB[]>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map<number, { r: number; g: number; b: number; n: number; sat: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const light = (max + min) / 2;
          if (light < 0.08 || light > 0.95) continue;
          const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
          let hue = 0;
          if (max !== min) {
            if (max === r) hue = ((g - b) / (max - min)) % 6;
            else if (max === g) hue = (b - r) / (max - min) + 2;
            else hue = (r - g) / (max - min) + 4;
          }
          const key2 = Math.round(((hue * 60 + 360) % 360) / 30) * 2 + (sat > 0.25 ? 1 : 0);
          const bk = buckets.get(key2) ?? { r: 0, g: 0, b: 0, n: 0, sat: 0 };
          bk.r += r; bk.g += g; bk.b += b; bk.n++; bk.sat += sat;
          buckets.set(key2, bk);
        }
        const ranked = [...buckets.values()]
          .map((bk) => ({ rgb: [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n] as RGB, score: bk.n * (0.4 + bk.sat / bk.n) }))
          .sort((a, b) => b.score - a.score);
        const colors = ranked.slice(0, 3).map((x) => x.rgb);
        while (colors.length < 3) colors.push(colors[0] ?? FALLBACK[colors.length]!);
        resolve(colors);
      } catch {
        resolve(hashPalette(seed));
      }
    };
    img.onerror = () => resolve(hashPalette(seed));
    img.src = src;
  });

  cache.set(key, palette);
  return palette;
}

export const toCss = ([r, g, b]: RGB) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
