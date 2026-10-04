import { useState } from 'react';
import { useConnectStore } from '../store/connect';

/** Settings → "This device": the name other devices see in the device picker. */
export function DeviceNameSection() {
  const status = useConnectStore((s) => s.status);
  const deviceName = useConnectStore((s) => s.deviceName);
  const rename = useConnectStore((s) => s.renameThisDevice);
  const [value, setValue] = useState(deviceName);
  const [saved, setSaved] = useState(false);

  if (status === 'unavailable') return null;

  const changed = value.trim() !== '' && value.trim() !== deviceName;

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">This device</h2>
      <p className="text-sm text-zinc-400 mb-3">
        The name your other devices show in the device picker, so you can send music here or control it from them.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed) return;
          void rename(value).then(() => setSaved(true));
        }}
        className="flex items-center gap-3 max-w-md"
      >
        <label htmlFor="device-name" className="sr-only">Device name</label>
        <input
          id="device-name"
          value={value}
          maxLength={40}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={!changed}
          className="bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-xs text-zinc-400">Saved</span>}
      </form>
    </section>
  );
}
