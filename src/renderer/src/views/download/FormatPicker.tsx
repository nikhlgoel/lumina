import { Check } from 'lucide-react';
import type { ContentType, MediaInfo, Preset } from '@shared/types';
import { qualityNote, sourceMaxHeight } from '@core/presets';
import { formatBytes, resolutionLabel } from '@core/format';
import { cn } from '@/lib/cn';

/** Rough output size for a preset, from the streams the source offers. */
function estimateSize(preset: Preset, info: MediaInfo): number | null {
  const f = preset.format;
  const audio = info.audioStreams[0]?.sizeBytes ?? 0;
  if (f.kind === 'audio') {
    if (f.target === 'original' || !info.durationSec) return info.audioStreams[0]?.sizeBytes ?? null;
    const kbps = f.target === 'flac' ? 900 : f.target === 'wav' ? 1411 : f.bitrateKbps ?? 256;
    return Math.round((kbps * 1000 * info.durationSec) / 8);
  }
  const fitting = info.videoStreams.filter((v) =>
    (!f.maxHeight || v.height <= f.maxHeight) && (!f.maxFps || v.fps <= f.maxFps) && (f.allowHdr || !v.hdr) && (!f.tvSafe || v.codec === 'h264'));
  const best = fitting[0] ?? info.videoStreams.find((v) => !f.maxHeight || v.height <= f.maxHeight);
  return best?.sizeBytes ? best.sizeBytes + audio : null;
}

function describe(preset: Preset, info: MediaInfo): string {
  const f = preset.format;
  if (f.kind === 'audio') {
    if (f.target === 'original') {
      const a = info.audioStreams[0];
      return a ? `${a.codec.toUpperCase()}${a.bitrateKbps ? ` · ${a.bitrateKbps} kbps` : ''} as served` : preset.description;
    }
    return preset.description;
  }
  if (!f.maxHeight && !f.tvSafe) {
    const top = info.videoStreams[0];
    return top ? `${resolutionLabel(top.height)}${top.fps > 30 ? top.fps : ''}${top.hdr ? ' HDR' : ''} · ${top.codec.toUpperCase()}` : preset.description;
  }
  return preset.description;
}

export function FormatPicker({ presets, contentType, info, value, onChange }: {
  presets: Preset[]; contentType: ContentType; info: MediaInfo; value: string; onChange: (id: string) => void;
}) {
  const max = sourceMaxHeight(info);
  const list = presets.filter((p) => p.appliesTo.includes(contentType));
  // Hide resolution tiers the source can't reach, except the next one up (shown disabled for context).
  const visible = list.filter((p) => p.format.kind === 'audio' || !p.format.maxHeight || p.format.tvSafe || !max || p.format.maxHeight <= max * 1.5);
  const selected = list.find((p) => p.id === value);
  const note = selected ? qualityNote(selected.format, info) : null;

  return (
    <div>
      <div role="radiogroup" aria-label="Format" className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {visible.map((p) => {
          const unreachable = p.format.kind === 'video' && !!p.format.maxHeight && !p.format.tvSafe && !!max && p.format.maxHeight > max;
          const checked = p.id === value;
          const size = estimateSize(p, info);
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={checked}
              disabled={unreachable}
              onClick={() => onChange(p.id)}
              title={unreachable ? `This source only goes up to ${max}p` : undefined}
              className={cn(
                'group relative flex flex-col items-start rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 active:scale-[0.99]',
                checked ? 'border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]' : 'border-line bg-raised hover:border-line-strong hover:bg-hover',
                unreachable && 'opacity-40',
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className={cn('grid size-4 place-items-center rounded-full border transition-colors', checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
                  {checked && <Check className="size-3" strokeWidth={3} />}
                </span>
              </span>
              <span className="mt-1 line-clamp-2 text-xs leading-snug text-ink-3">{describe(p, info)}</span>
              {size && !unreachable && <span className="mt-2 text-[11px] font-semibold text-ink-3 tabular">≈ {formatBytes(size)}</span>}
            </button>
          );
        })}
      </div>
      {note && <p className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-[13px] leading-relaxed text-ink-2">{note}</p>}
    </div>
  );
}
