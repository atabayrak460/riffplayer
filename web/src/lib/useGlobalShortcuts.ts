import { useEffect } from 'react';
import { usePlayerStore, effectiveVolume } from '../store/player';
import { useUiMenuStore } from '../store/uiMenu';
import { handleKeyboardShortcut } from './keyboard';

/** Wires up the app-wide playback keyboard shortcuts (see keyboard.ts) on document. */
export function useGlobalShortcuts(setShowShortcutsHelp: (updater: (v: boolean) => boolean) => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A context/options menu (ContextMenu.tsx) has its own ArrowUp/Down
      // keydown listener on document for navigating its items — without this
      // guard, the same arrow press also fell through to the global
      // shortcuts below and changed playback volume at the same time.
      if (useUiMenuStore.getState().activeMenuId != null) return;
      // Read live state at call time (not via a hook) so this listener
      // never needs re-subscribing as playback state changes every second.
      const s = usePlayerStore.getState();
      const handled = handleKeyboardShortcut(e, {
        currentTime: s.currentTime,
        duration: s.duration,
        volume: effectiveVolume(),
        togglePlay: s.togglePlay,
        seek: s.seek,
        setVolume: s.setVolume,
        next: s.next,
        prev: s.prev,
        toggleShuffle: s.toggleShuffle,
        toggleRepeat: s.toggleRepeat,
        toggleMute: s.toggleMute,
        toggleShortcutsHelp: () => setShowShortcutsHelp((v) => !v),
      });
      if (handled) e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setShowShortcutsHelp]);
}
