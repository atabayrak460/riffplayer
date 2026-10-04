import { Link } from 'react-router-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  viewAllTo?: string;
  children: ReactNode;
}

const FADE_STYLE = {
  maskImage: 'linear-gradient(to right, black calc(100% - 3rem), transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 3rem), transparent 100%)',
};

/** A horizontally-scrolling row of cards, used throughout the Home page. */
export function HomeRow({ title, viewAllTo, children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">{title}</h3>
        {viewAllTo && (
          <Link to={viewAllTo} className="text-xs text-zinc-400 hover:text-zinc-50 transition-colors">
            See all
          </Link>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1"
        style={overflowing ? FADE_STYLE : undefined}
      >
        {children}
      </div>
    </div>
  );
}
