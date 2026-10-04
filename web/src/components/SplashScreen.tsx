import { useEffect, useState } from 'react';

const SHOW_MS = 1300;
const FADE_MS = 400;

// Module-level on purpose: the intro belongs to a cold start (a page load),
// not to every remount of <App> (StrictMode, tests, hot reload).
let alreadyPlayed = false;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Short logo intro shown over the app on a cold start. It's only an overlay —
 * the app (and its auth/resume work) keeps loading underneath, so it never
 * delays anything — and a click, tap or key press skips it.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<'show' | 'fade' | 'done'>(() => {
    if (alreadyPlayed || prefersReducedMotion()) return 'done';
    return 'show';
  });

  useEffect(() => {
    if (phase !== 'show') return;
    alreadyPlayed = true;
    const toFade = setTimeout(() => setPhase('fade'), SHOW_MS);
    return () => clearTimeout(toFade);
  }, [phase]);

  useEffect(() => {
    if (phase === 'done') return;
    const skip = () => setPhase((p) => (p === 'show' ? 'fade' : p));
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'fade') return;
    const t = setTimeout(() => setPhase('done'), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'done') return null;

  const mask = "url('/logo-mark.png') center / contain no-repeat";
  return (
    <div
      aria-hidden="true"
      data-testid="splash"
      onClick={() => setPhase((p) => (p === 'show' ? 'fade' : p))}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950"
      style={phase === 'fade' ? { animation: `splash-out ${FADE_MS}ms ease-out forwards` } : undefined}
    >
      {[0, 0.35].map((delay) => (
        <span
          key={delay}
          className="absolute w-40 h-40 rounded-full border-2 border-brand"
          style={{ animation: `splash-ring 1.2s ease-out ${delay + 0.2}s both` }}
        />
      ))}
      <div
        className="w-40 h-36 bg-brand"
        style={{
          WebkitMask: mask,
          mask,
          animation: 'splash-logo-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        }}
      />
    </div>
  );
}
