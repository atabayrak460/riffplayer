import { useEffect, useState } from 'react';
import { useDownloadsStore, type DownloadTarget } from '../store/downloads';
import { isIOS } from '../lib/platform';
import { Modal } from './Modal';

type ChosenTarget = Exclude<DownloadTarget, 'ask'>;

/**
 * Mounted once at the app root. Shown whenever a "Download" action has no
 * default target to fall back to yet — asks where, then whether to remember
 * that choice for next time (both local to this device, never sent to the server).
 */
export function DownloadTargetModal() {
  const pending = useDownloadsStore((s) => s.pendingRequest);
  const resolvePendingRequest = useDownloadsStore((s) => s.resolvePendingRequest);
  const cancelPendingRequest = useDownloadsStore((s) => s.cancelPendingRequest);
  const [step, setStep] = useState<'choose' | 'remember'>('choose');
  const [chosen, setChosen] = useState<ChosenTarget | null>(null);

  useEffect(() => {
    if (pending) {
      setStep('choose');
      setChosen(null);
    }
  }, [pending]);

  if (!pending) return null;

  const choose = (target: ChosenTarget) => {
    setChosen(target);
    setStep('remember');
  };

  const finish = (remember: boolean) => {
    if (chosen) resolvePendingRequest(chosen, remember);
  };

  return (
    <Modal onClose={cancelPendingRequest} label="Download to…" className="p-6 w-full max-w-sm">
      {step === 'choose' ? (
        <>
          <h2 className="text-zinc-50 font-semibold mb-1">Download to…</h2>
          <p className="text-xs text-zinc-400 mb-4">Choose where downloads should go.</p>
          <div className="space-y-2">
            <button
              onClick={() => choose('app')}
              className="w-full text-left bg-zinc-900 hover:bg-zinc-700 border border-zinc-700 rounded-lg p-3 transition-colors"
            >
              <p className="text-sm font-medium text-zinc-50">In RiffPlayer</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Play offline inside the app, from the Downloaded tab.
              </p>
              {isIOS() && (
                <p className="text-xs text-amber-400 mt-1.5">
                  On iOS, Safari may clear downloads if you don't open RiffPlayer for a while. The
                  native app (coming later) won't have this limit.
                </p>
              )}
            </button>
            <button
              onClick={() => choose('device')}
              className="w-full text-left bg-zinc-900 hover:bg-zinc-700 border border-zinc-700 rounded-lg p-3 transition-colors"
            >
              <p className="text-sm font-medium text-zinc-50">To this device</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Save as a plain file in your Downloads folder.
              </p>
            </button>
          </div>
          <button
            onClick={cancelPendingRequest}
            className="mt-4 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <h2 className="text-zinc-50 font-semibold mb-1">Remember this choice?</h2>
          <p className="text-xs text-zinc-400 mb-4">
            Applies only on this device — you can change it later in Settings.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => finish(true)}
              className="flex-1 bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors"
            >
              Yes, always use this
            </button>
            <button
              onClick={() => finish(false)}
              className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-50 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              Just this once
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
