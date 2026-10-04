import { useThemeStore, type ThemeMode } from '../store/theme';
import { UI_STYLES, useUiStyleStore } from '../store/uiStyle';

const OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follow the device setting' },
  { value: 'dark', label: 'Dark', hint: 'Deep navy with amber' },
  { value: 'light', label: 'Light', hint: 'Warm cream with amber' },
];

export function AppearanceSection() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const style = useUiStyleStore((s) => s.style);
  const setStyle = useUiStyleStore((s) => s.setStyle);

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Appearance</h2>
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-3">
        {OPTIONS.map((o) => {
          const selected = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(o.value)}
              className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                selected ? 'border-brand bg-zinc-800' : 'border-zinc-700 hover:border-zinc-600'
              }`}
            >
              <span className={`block text-sm font-medium ${selected ? 'text-brand' : 'text-zinc-50'}`}>{o.label}</span>
              <span className="block text-xs text-zinc-400 mt-0.5">{o.hint}</span>
            </button>
          );
        })}
      </div>

      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mt-6 mb-3">Interface style</h3>
      <div role="radiogroup" aria-label="Interface style" className="flex flex-wrap gap-3">
        {UI_STYLES.map((o) => {
          const selected = style === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setStyle(o.id)}
              className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                selected ? 'border-brand bg-zinc-800' : 'border-zinc-700 hover:border-zinc-600'
              }`}
            >
              <span className={`block text-sm font-medium ${selected ? 'text-brand' : 'text-zinc-50'}`}>{o.label}</span>
              <span className="block text-xs text-zinc-400 mt-0.5">{o.hint}</span>
            </button>
          );
        })}
      </div>
      {style !== 'default' && (
        <p className="text-xs text-zinc-500 mt-3">This style has its own colours, so the theme above doesn&apos;t apply to it.</p>
      )}
    </section>
  );
}
