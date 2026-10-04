import { useQuery } from '@tanstack/react-query';
import type { Song } from '../api/types';
import { getMyTranscodePrefs, getTrackCredits } from '../api/subsonic';
import { creditRows } from '../lib/credits';
import { audioQuality, signalPath } from '../lib/quality';
import { Modal } from './Modal';
import { QualityBadge } from './QualityBadge';

interface Props {
  song: Song;
  onClose: () => void;
}

function formatDuration(s?: number) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function SongInfoDialog({ song, onClose }: Props) {
  const { data: prefs } = useQuery({ queryKey: ['transcode-prefs'], queryFn: getMyTranscodePrefs, staleTime: 60_000 });
  // The file's own tags; a 404 (file unreadable) or any failure just means "no credits to show".
  const { data: credits } = useQuery({
    queryKey: ['track-credits', song.id],
    queryFn: () => getTrackCredits(song.id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const creditList = creditRows(credits);
  const quality = audioQuality(song);
  const steps = signalPath(song, prefs);
  const rows: [string, string][] = [
    ['Title', song.title],
    ['Artist', song.artist],
    ['Album', song.album],
    ['Duration', formatDuration(song.duration)],
  ];
  if (song.suffix) rows.push(['Format', song.suffix.toUpperCase()]);
  if (song.samplingRate) rows.push(['Sample rate', `${Number((song.samplingRate / 1000).toFixed(1))} kHz`]);
  if (song.bitDepth) rows.push(['Bit depth', `${song.bitDepth}-bit`]);
  if (song.bitRate) rows.push(['Bitrate', `${song.bitRate} kbps`]);
  if (song.playCount != null) rows.push(['Play count', String(song.playCount)]);

  return (
    <Modal onClose={onClose} label="Song info" className="p-5 w-full max-w-sm">
      <h2 className="text-zinc-50 font-semibold mb-4">Song info</h2>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <dt className="text-zinc-400">{label}</dt>
            <dd className="text-zinc-50 text-right truncate">{value}</dd>
          </div>
        ))}
      </dl>
      {creditList.length > 0 && (
        <section aria-label="Credits" className="mt-5 pt-4 border-t border-zinc-700">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Credits</h3>
          <dl className="space-y-2">
            {creditList.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 text-sm">
                <dt className="text-zinc-400 flex-shrink-0">{label}</dt>
                <dd className="text-zinc-50 text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {quality.label && (
        <section aria-label="Signal path" className="mt-5 pt-4 border-t border-zinc-700">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
            Signal path <QualityBadge song={song} />
          </h3>
          <ol className="space-y-2">
            {steps.map((step) => (
              <li key={step.stage} className="text-sm">
                <span className="text-zinc-400">{step.stage}: </span>
                <span className={step.degraded ? 'text-amber-400' : 'text-zinc-50'}>{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <button onClick={onClose} className="mt-4 text-xs text-zinc-500 hover:text-zinc-300">
        Close
      </button>
    </Modal>
  );
}
