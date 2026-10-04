import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveDeviceCode, getLinkedDevices, unlinkDevice } from '../api/subsonic';

/** "Link a TV": type the code a TV shows (it signs in without a password), and unlink devices again. */
export function LinkedDevicesSection() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { data: devices = [] } = useQuery({ queryKey: ['linked-devices'], queryFn: getLinkedDevices });

  const approve = useMutation({
    mutationFn: () => approveDeviceCode(code.trim()),
    onSuccess: (name) => {
      setMessage({ ok: true, text: `${name} is now linked.` });
      setCode('');
      void qc.invalidateQueries({ queryKey: ['linked-devices'] });
    },
    onError: (e: Error) => setMessage({ ok: false, text: e.message }),
  });
  const unlink = useMutation({
    mutationFn: (id: number) => unlinkDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['linked-devices'] }),
  });

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Link a TV</h2>
      <p className="text-sm text-zinc-400 mb-3 max-w-md">
        Open RiffPlayer on your Android TV — it shows a code. Type it here to sign the TV in without typing your password on it.
      </p>
      <form
        className="flex gap-2 max-w-md"
        onSubmit={(e) => { e.preventDefault(); if (code.trim()) approve.mutate(); }}
      >
        <input
          aria-label="Code shown on the TV"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          maxLength={12}
          autoComplete="off"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm tracking-widest"
        />
        <button
          type="submit"
          disabled={approve.isPending || !code.trim()}
          className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-4 rounded-lg disabled:opacity-50"
        >
          Link
        </button>
      </form>
      {message && <p className={`text-xs mt-2 ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}

      {devices.length > 0 && (
        <ul className="mt-4 max-w-md space-y-2" aria-label="Linked devices">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm text-zinc-50">
              <span className="truncate">
                {d.name}
                <span className="block text-xs text-zinc-500">
                  {d.lastUsed ? `Last used ${new Date(d.lastUsed * 1000).toLocaleDateString()}` : 'Not used yet'}
                </span>
              </span>
              <button type="button" onClick={() => unlink.mutate(d.id)} className="text-xs text-zinc-400 hover:text-red-400">
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
