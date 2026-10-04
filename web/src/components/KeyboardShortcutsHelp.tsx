import { SHORTCUTS_HELP } from '../lib/keyboard';
import { Modal } from './Modal';

interface Props {
  onClose: () => void;
}

/** Opened by the "?" shortcut (see Layout.tsx) — lists every global playback shortcut. */
export function KeyboardShortcutsHelp({ onClose }: Props) {
  return (
    <Modal onClose={onClose} label="Keyboard shortcuts" className="p-5 w-full max-w-sm">
      <h2 className="text-zinc-50 font-semibold mb-4">Keyboard shortcuts</h2>
      <dl className="space-y-2">
        {SHORTCUTS_HELP.map(({ keys, description }) => (
          <div key={keys} className="flex justify-between items-center gap-4 text-sm">
            <dt className="text-zinc-400">{description}</dt>
            <dd className="text-zinc-50 font-mono text-xs bg-zinc-700/60 rounded px-2 py-0.5">{keys}</dd>
          </div>
        ))}
      </dl>
      <button onClick={onClose} className="mt-4 text-xs text-zinc-500 hover:text-zinc-300">
        Close
      </button>
    </Modal>
  );
}
