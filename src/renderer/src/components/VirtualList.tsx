import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Fixed-row-height windowed list. Renders only visible rows plus a small overscan. */
export function VirtualList<T>({ items, rowHeight, render, overscan = 8, className }: {
  items: T[]; rowHeight: number; render: (item: T, index: number) => ReactNode; overscan?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ top: 0, height: 800 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRange({ top: el.scrollTop, height: el.clientHeight }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const start = Math.max(0, Math.floor(range.top / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((range.top + range.height) / rowHeight) + overscan);

  return (
    <div ref={ref} className={className} style={{ overflowY: 'auto' }}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(start, end).map((item, i) => (
          <div key={start + i} style={{ position: 'absolute', top: (start + i) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {render(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
