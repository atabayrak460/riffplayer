import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CoverArt } from './CoverArt';
import { usePlayerStore } from '../store/player';
import { getAlbum } from '../api/subsonic';
import type { Album } from '../api/types';

/** Albums further than this from the centre aren't rendered at all (keeps 100+ albums cheap). */
const VISIBLE_RADIUS = 7;
const SIZE = 230;

/** Pose of the item `d` places from the centre — the classic Cover Flow fan:
 *  the centre faces front and pops forward, the rest turn away on both sides.
 *  Each item carries its own `perspective()` and the stacking is done with
 *  z-index (see below), so the order never depends on how a browser sorts 3D layers. */
export function coverFlowTransform(d: number): string {
  if (d === 0) return 'perspective(900px) translateX(0) translateZ(70px) rotateY(0deg)';
  const side = Math.sign(d);
  // The first side cover starts just beyond the centre cover's edge; the rest are spaced
  // closer together, each overlapping the one outside it.
  const x = side * (SIZE * 0.86 + (Math.abs(d) - 1) * 56);
  return `perspective(900px) translateX(${x}px) translateZ(-60px) rotateY(${-side * 58}deg)`;
}

interface Props {
  albums: Album[];
}

export function CoverFlow({ albums }: Props) {
  const [active, setActive] = useState(0);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const rootRef = useRef<HTMLDivElement>(null);
  const last = albums.length - 1;
  const index = Math.min(active, Math.max(last, 0));

  const go = (i: number) => setActive(Math.max(0, Math.min(last, i)));
  // Relative moves use the latest state, so a held-down arrow key never loses steps.
  const step = (delta: number) => setActive((a) => Math.max(0, Math.min(last, a + delta)));

  // Reset when the list underneath is swapped (a different sort order).
  useEffect(() => setActive(0), [albums]);

  // The wheel flips through covers; a plain listener, because React's onWheel is passive
  // and couldn't stop the page from scrolling underneath.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(acc) >= 40) {
        const step = Math.sign(acc);
        acc = 0;
        setActive((a) => Math.max(0, Math.min(last, a + step)));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [last]);

  if (albums.length === 0) return null;
  const current = albums[index];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(last); }
  };

  const playCurrent = async () => {
    try {
      playQueue((await getAlbum(current.id)).song ?? []);
    } catch {
      // ignore
    }
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="Albums, Cover Flow"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="select-none focus:outline-none"
    >
      <div
        className="coverflow relative overflow-hidden rounded-lg bg-gradient-to-b from-black to-[#303030]"
        style={{ height: SIZE + 110, ['--cf-size' as string]: `${SIZE}px` }}
      >
        <div className="relative" style={{ height: SIZE, marginTop: 28 }}>
          {albums.map((album, i) => {
            const d = i - index;
            if (Math.abs(d) > VISIBLE_RADIUS) return null;
            return (
              <div
                key={album.id}
                data-testid="coverflow-item"
                data-offset={d}
                className="coverflow-item"
                style={{ transform: coverFlowTransform(d), zIndex: 100 - Math.abs(d) }}
                onClick={d === 0 ? undefined : () => go(i)}
              >
                {d === 0 ? (
                  <Link to={`/albums/${album.id}`} aria-label={`Open ${album.name}`} tabIndex={-1}>
                    <CoverArt id={album.coverArt} size={400} className="w-full h-full object-cover" alt={album.name} />
                  </Link>
                ) : (
                  <CoverArt id={album.coverArt} size={300} className="w-full h-full object-cover" alt="" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center mt-4 min-h-[3.5rem]" aria-live="polite">
        <p className="text-lg font-bold text-zinc-50 truncate">{current.name}</p>
        <p className="text-sm text-zinc-400 truncate">{current.artist}</p>
      </div>

      <div className="flex items-center gap-3 mt-2 max-w-xl mx-auto">
        <input
          type="range"
          aria-label="Browse albums"
          min={0}
          max={last}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
        />
        <button
          type="button"
          onClick={playCurrent}
          className="flex-shrink-0 px-4 py-1.5 rounded-full bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium"
        >
          Play
        </button>
      </div>
    </div>
  );
}
