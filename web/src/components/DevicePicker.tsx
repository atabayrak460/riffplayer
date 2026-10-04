import { useEffect, useRef, useState } from 'react';
import { useConnectStore } from '../store/connect';
import type { DeviceInfo } from '../api/connect';

const TYPE_LABEL: Record<DeviceInfo['type'], string> = { web: 'Web', android: 'Android', desktop: 'Desktop' };

/** This device first, then whichever is playing, then the rest online, then the ones that are gone. */
function sortDevices(devices: DeviceInfo[], thisId: string): DeviceInfo[] {
  const rank = (d: DeviceInfo) => (d.id === thisId ? 0 : d.active ? 1 : d.online ? 2 : 3);
  return [...devices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function subtitle(d: DeviceInfo, thisId: string): string {
  const parts = [TYPE_LABEL[d.type]];
  if (d.id === thisId) parts.push('This device');
  if (d.active && d.online) parts.push('Playing');
  if (!d.online) parts.push(d.unreachable ? 'Unreachable' : 'Reconnecting…');
  return parts.join(' · ');
}

/** Speaker button + popover to pick which of your devices plays (Spotify-Connect style). */
export function DevicePicker({ className = '' }: { className?: string }) {
  const status = useConnectStore((s) => s.status);
  const devices = useConnectStore((s) => s.devices);
  const thisId = useConnectStore((s) => s.deviceId);
  const activeId = useConnectStore((s) => s.activeDeviceId);
  const transferTo = useConnectStore((s) => s.transferTo);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nothing to offer before sign-in, or against an older server that has no Connect.
  if (status === 'idle' || status === 'unavailable') return null;

  const remoteActive = activeId !== null && activeId !== thisId;
  const list = sortDevices(devices, thisId);
  const others = list.filter((d) => d.id !== thisId);

  const choose = (d: DeviceInfo) => {
    setOpen(false);
    if (d.active && d.online) return; // already the one playing
    if (!d.online && d.id !== thisId) return; // can't hand over to something that isn't there
    void transferTo(d.id);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Connect to a device"
        aria-label="Connect to a device"
        aria-expanded={open}
        className={`transition-colors ${remoteActive ? 'text-brand' : 'text-zinc-400 hover:text-zinc-50'}`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Devices"
          className="absolute bottom-full right-0 mb-3 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl p-2 z-30"
        >
          <p className="px-2 pt-1 pb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Connect to a device</p>

          {status !== 'online' && (
            <p className="px-2 pb-2 text-xs text-amber-400">
              {status === 'connecting' ? 'Connecting…' : 'Not connected — trying again'}
            </p>
          )}

          {list.map((d) => {
            const isThis = d.id === thisId;
            const disabled = !d.online && !isThis;
            return (
              <button
                key={d.id}
                role="menuitem"
                onClick={() => choose(d)}
                disabled={disabled}
                aria-current={d.active ? 'true' : undefined}
                className={`w-full flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                  disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-zinc-800'
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${d.active && d.online ? 'bg-brand' : d.online ? 'bg-zinc-500' : 'bg-zinc-700'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm truncate ${d.active && d.online ? 'text-brand font-medium' : 'text-zinc-50'}`}>{d.name}</span>
                  <span className="block text-xs text-zinc-400 truncate">{subtitle(d, thisId)}</span>
                </span>
                {isThis && !d.active && remoteActive && (
                  <span className="text-xs text-zinc-300 flex-shrink-0">Play here</span>
                )}
              </button>
            );
          })}

          {status === 'online' && others.length === 0 && (
            <p className="px-2 py-2 text-xs text-zinc-400">Open RiffPlayer on another device to see it here.</p>
          )}
        </div>
      )}
    </div>
  );
}
