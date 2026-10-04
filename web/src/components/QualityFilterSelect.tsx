import type { QualityFilter } from '../api/subsonic';

const OPTIONS: { value: QualityFilter; label: string }[] = [
  { value: '', label: 'All quality' },
  { value: 'lossless', label: 'Lossless' },
  { value: 'hires', label: 'Hi-Res only' },
];

/** Dropdown for the lossless / Hi-Res filter (All Songs and Albums). */
export function QualityFilterSelect({ value, onChange }: { value: QualityFilter; onChange: (v: QualityFilter) => void }) {
  return (
    <select
      aria-label="Filter by audio quality"
      value={value}
      onChange={(e) => onChange(e.target.value as QualityFilter)}
      className="bg-zinc-800 text-zinc-200 rounded-md px-2 py-1.5 border border-zinc-700"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
