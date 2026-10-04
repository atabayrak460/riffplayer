import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminGetLibraries, adminAddLibrary, adminDeleteLibrary, adminScanLibrary } from '../../api/subsonic';

export function LibrariesPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', path: '' });
  const [scanning, setScanning] = useState<number | null>(null);

  const { data: libraries = [], isLoading } = useQuery({ queryKey: ['admin-libraries'], queryFn: adminGetLibraries });

  const addMut = useMutation({
    mutationFn: adminAddLibrary,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-libraries'] }); setAdding(false); setForm({ name: '', path: '' }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDeleteLibrary(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-libraries'] }),
  });

  const scan = async (id: number) => {
    setScanning(id);
    try {
      await adminScanLibrary(id);
      // Reflects the server's own scanning state (true for every client,
      // not just this tab) — the backend now rejects an overlapping scan
      // of the same library with a 409, caught below.
      qc.invalidateQueries({ queryKey: ['admin-libraries'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setScanning(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-zinc-50">Music Libraries</h2>
        <button onClick={() => setAdding(v => !v)} className="bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors">+ Add library</button>
      </div>

      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(form); }} className="bg-zinc-800 rounded-lg p-4 mb-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">New library</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Name (e.g. Music)" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand" />
            <input placeholder="Path (e.g. /music)" value={form.path} onChange={e => setForm(p => ({ ...p, path: e.target.value }))} required className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={addMut.isPending} className="bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-1.5 rounded transition-colors disabled:opacity-60">Add</button>
            <button type="button" onClick={() => setAdding(false)} className="text-zinc-400 hover:text-zinc-50 text-sm px-3 py-1.5">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-14 bg-zinc-800 rounded animate-pulse" />)}</div>
      ) : libraries.length === 0 ? (
        <p className="text-zinc-400 text-sm">No libraries yet. Add your music folder path above.</p>
      ) : (
        <div className="space-y-2">
          {libraries.map(lib => (
            <div key={lib.id} className="flex items-center gap-4 px-4 py-3 bg-zinc-800/40 rounded-lg group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-50">{lib.name}</p>
                <p className="text-xs text-zinc-400 font-mono">{lib.path}</p>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => scan(lib.id)}
                  disabled={scanning === lib.id || lib.scanning}
                  className="text-xs text-zinc-300 hover:text-zinc-50 border border-zinc-600 px-3 py-1 rounded transition-colors disabled:opacity-50"
                >
                  {scanning === lib.id || lib.scanning ? 'Scanning…' : '⟳ Scan'}
                </button>
                <button onClick={() => { if (confirm(`Remove library "${lib.name}"? Track data stays.`)) deleteMut.mutate(lib.id); }} className="text-xs text-red-500 hover:text-red-400 border border-red-900 px-2 py-1 rounded transition-colors">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
