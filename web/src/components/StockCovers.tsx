import { useId } from 'react';

/**
 * Stock cover art for views and playlists with no real artwork.
 *
 * Shared style language across all seven: same dark diagonal gradient base,
 * the same 35°-tilted hairline texture, and the same construction (one soft
 * blurred glow + flat-gradient angular shapes) — only the palette and shape
 * motif differ per category. Approved design: see Phase 1 review artifact.
 *
 * Each component takes its own `useId()`-derived prefix so multiple instances
 * (e.g. a list of playlists all falling back to <PlaylistCover />) never
 * collide on gradient/pattern/filter ids within the same document.
 */

interface CoverProps {
  className?: string;
}

function useUid() {
  return useId().replace(/[^a-zA-Z0-9]/g, '');
}

export function MostPlayedCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="400" x2="400" y2="0">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="30" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="300" cy="110" r="95" fill="#f97316" opacity="0.35" filter={`url(#${id}-blur)`} />
      <line x1="70" y1="345" x2="330" y2="345" stroke="#fbbf24" strokeOpacity="0.25" strokeWidth="2" />
      <polygon points="95,345 129,345 117,265 83,265" fill={`url(#${id}-grad)`} opacity="0.75" />
      <polygon points="150,345 184,345 172,205 138,205" fill={`url(#${id}-grad)`} opacity="0.85" />
      <polygon points="205,345 239,345 227,140 193,140" fill={`url(#${id}-grad)`} opacity="0.95" />
      <polygon points="260,345 294,345 282,70 248,70" fill={`url(#${id}-grad)`} opacity="1" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function RecentlyPlayedCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="40" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="200" cy="200" r="120" fill="#38bdf8" opacity="0.22" filter={`url(#${id}-blur)`} />
      <path d="M 314.9,103.5 A 150,150 0 0 1 226.0,347.7" fill="none" stroke={`url(#${id}-grad)`} strokeWidth="16" strokeLinecap="round" opacity="0.65" />
      <path d="M 115.7,270.7 A 110,110 0 0 1 129.3,115.7" fill="none" stroke={`url(#${id}-grad)`} strokeWidth="14" strokeLinecap="round" opacity="0.85" />
      <path d="M 176.1,134.2 A 70,70 0 0 1 245.0,146.4" fill="none" stroke={`url(#${id}-grad)`} strokeWidth="12" strokeLinecap="round" opacity="1" />
      <circle cx="245.0" cy="146.4" r="8" fill="#a5b4fc" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function DownloadedCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="0" y2="400">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="35" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="200" cy="330" r="110" fill="#10b981" opacity="0.3" filter={`url(#${id}-blur)`} />
      <polygon points="160,165 240,165 200,230" fill={`url(#${id}-grad)`} opacity="0.5" />
      <polygon points="140,230 260,230 200,300" fill={`url(#${id}-grad)`} opacity="0.75" />
      <polygon points="120,300 280,300 200,380" fill={`url(#${id}-grad)`} opacity="1" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function FavouritesCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#db2777" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="45" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="200" cy="200" r="130" fill="#fb7185" opacity="0.22" filter={`url(#${id}-blur)`} />
      <g transform="rotate(0 200 200)"><polygon points="200,90 225,175 200,230 175,175" fill={`url(#${id}-grad)`} opacity="0.65" /></g>
      <g transform="rotate(72 200 200)"><polygon points="200,90 225,175 200,230 175,175" fill={`url(#${id}-grad)`} opacity="0.85" /></g>
      <g transform="rotate(144 200 200)"><polygon points="200,90 225,175 200,230 175,175" fill={`url(#${id}-grad)`} opacity="1" /></g>
      <g transform="rotate(216 200 200)"><polygon points="200,90 225,175 200,230 175,175" fill={`url(#${id}-grad)`} opacity="0.85" /></g>
      <g transform="rotate(288 200 200)"><polygon points="200,90 225,175 200,230 175,175" fill={`url(#${id}-grad)`} opacity="0.65" /></g>
      <circle cx="200" cy="200" r="11" fill="#fecdd3" opacity="0.95" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function DiscoverCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" style={{ stopColor: 'rgb(var(--brand))' }} />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="38" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="140" cy="260" r="100" fill="#22d3ee" opacity="0.2" filter={`url(#${id}-blur)`} />
      <circle cx="280" cy="120" r="70" style={{ fill: 'rgb(var(--brand))' }} opacity="0.2" filter={`url(#${id}-blur)`} />
      <polygon points="230,150 320,190 250,260" fill={`url(#${id}-grad)`} opacity="1" />
      <polygon points="120,120 175,100 190,150 135,165" fill={`url(#${id}-grad)`} opacity="0.85" />
      <polygon points="80,230 120,215 110,260" fill={`url(#${id}-grad)`} opacity="0.7" />
      <polygon points="300,280 340,300 305,330" fill={`url(#${id}-grad)`} opacity="0.6" />
      <polygon points="190,320 220,310 205,345" fill={`url(#${id}-grad)`} opacity="0.5" />
      <circle cx="95" cy="170" r="4" fill="#22d3ee" opacity="0.8" />
      <circle cx="330" cy="230" r="4" style={{ fill: 'rgb(var(--brand))' }} opacity="0.8" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function WrappedCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="40" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="160" cy="300" r="90" fill="#f472b6" opacity="0.22" filter={`url(#${id}-blur)`} />
      <circle cx="260" cy="290" r="90" fill="#fb923c" opacity="0.18" filter={`url(#${id}-blur)`} />

      <g transform="translate(140,330) rotate(10)"><polygon points="0,-26 22.6,13 -22.6,13" fill="#f472b6" opacity="0.9" /></g>
      <g transform="translate(200,350) rotate(-15)"><polygon points="0,-30 26,15 -26,15" style={{ fill: 'rgb(var(--brand))' }} opacity="0.95" /></g>
      <g transform="translate(260,325) rotate(20)"><polygon points="0,-24 20.8,12 -20.8,12" fill="#fb923c" opacity="0.9" /></g>
      <g transform="translate(110,270) rotate(40)"><polygon points="0,-20 17.3,10 -17.3,10" fill="#fb923c" opacity="0.85" /></g>
      <g transform="translate(180,260) rotate(-25)"><polygon points="0,-26 22.6,13 -22.6,13" fill="#f472b6" opacity="0.85" /></g>
      <g transform="translate(250,250) rotate(15)"><polygon points="0,-22 19,11 -19,11" style={{ fill: 'rgb(var(--brand))' }} opacity="0.9" /></g>
      <g transform="translate(300,270) rotate(-10)"><polygon points="0,-18 15.6,9 -15.6,9" fill="#f472b6" opacity="0.8" /></g>
      <g transform="translate(150,190) rotate(30)"><polygon points="0,-18 15.6,9 -15.6,9" style={{ fill: 'rgb(var(--brand))' }} opacity="0.75" /></g>
      <g transform="translate(230,175) rotate(-20)"><polygon points="0,-20 17.3,10 -17.3,10" fill="#fb923c" opacity="0.75" /></g>
      <g transform="translate(90,200) rotate(50)"><polygon points="0,-14 12.1,7 -12.1,7" style={{ fill: 'rgb(var(--brand))' }} opacity="0.65" /></g>
      <g transform="translate(310,180) rotate(-35)"><polygon points="0,-16 13.9,8 -13.9,8" fill="#f472b6" opacity="0.65" /></g>
      <g transform="translate(200,110) rotate(5)"><polygon points="0,-16 13.9,8 -13.9,8" fill="#fb923c" opacity="0.6" /></g>

      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function AllSongsCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="36" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="290" cy="120" r="100" fill="#94a3b8" opacity="0.16" filter={`url(#${id}-blur)`} />
      {/* Stacked rows of varying width — an abstracted tracklist/index, standing in for "everything". */}
      <rect x="80" y="98" width="240" height="24" rx="6" fill={`url(#${id}-grad)`} opacity="1" />
      <rect x="80" y="138" width="180" height="24" rx="6" fill={`url(#${id}-grad)`} opacity="0.9" />
      <rect x="80" y="178" width="220" height="24" rx="6" fill={`url(#${id}-grad)`} opacity="0.82" />
      <rect x="80" y="218" width="140" height="24" rx="6" fill={`url(#${id}-grad)`} opacity="0.74" />
      <rect x="80" y="258" width="200" height="24" rx="6" fill={`url(#${id}-grad)`} opacity="0.66" />
      <rect x="80" y="298" width="160" height="24" rx="6" fill={`url(#${id}-grad)`} opacity="0.58" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}

export function PlaylistCover({ className }: CoverProps) {
  const id = useUid();
  return (
    <svg className={className} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" stopColor="#1c1a22" />
          <stop offset="1" stopColor="#08070a" />
        </linearGradient>
        <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="400" y2="400">
          <stop offset="0" style={{ stopColor: 'rgb(var(--brand))' }} />
          <stop offset="1" stopColor="#4c1d95" />
        </linearGradient>
        <pattern id={`${id}-hatch`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="40" />
        </filter>
      </defs>
      <rect width="400" height="400" fill={`url(#${id}-bg)`} />
      <circle cx="200" cy="200" r="120" style={{ fill: 'rgb(var(--brand))' }} opacity="0.18" filter={`url(#${id}-blur)`} />
      <circle cx="150" cy="160" r="70" fill={`url(#${id}-grad)`} opacity="0.55" />
      <rect x="190" y="150" width="130" height="130" rx="14" fill={`url(#${id}-grad)`} opacity="0.8" transform="rotate(18 255 215)" />
      <polygon points="120,330 210,330 165,240" fill={`url(#${id}-grad)`} opacity="1" />
      <rect width="400" height="400" fill={`url(#${id}-hatch)`} />
    </svg>
  );
}
