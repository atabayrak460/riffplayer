import { useMobileNavStore } from '../store/mobileNav';

/** Mobile-only (#22) top bar — the only way to reach the nav drawer below
 * the md breakpoint, since Sidebar itself is hidden there. */
export function MobileTopBar() {
  const open = useMobileNavStore((s) => s.open);

  return (
    <header className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-zinc-800 bg-zinc-950 flex-shrink-0">
      <button onClick={open} aria-label="Open menu" className="text-zinc-300 hover:text-zinc-50 transition-colors">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
        </svg>
      </button>
      <span className="text-base font-bold text-brand tracking-tight">RiffPlayer</span>
    </header>
  );
}
