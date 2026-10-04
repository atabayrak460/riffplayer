import type { Config } from 'tailwindcss';

// Every colour is a CSS variable (defined per theme in src/index.css), so the
// whole UI switches between dark / light / interface styles without touching
// components. NOTE: the `zinc` scale is deliberately OVERRIDDEN to mean "the
// neutral ramp of the current theme" (950 = page background … 50 = primary
// text) instead of Tailwind's stock grey — the components were written
// against `zinc-*` and keep working unchanged.
const ramp = (n: number) => `rgb(var(--c-${n}) / <alpha-value>)`;
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zinc: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, ramp(n)])),
        brand: {
          DEFAULT: token('brand'),
          dim: token('brand-dim'),
        },
        // Text/icon colour to put ON a brand-coloured surface.
        'on-brand': token('on-brand'),
        // Secondary accent (sea blue): links, focus, "this device" highlights.
        sea: token('sea'),
      },
    },
  },
  plugins: [],
} satisfies Config;
