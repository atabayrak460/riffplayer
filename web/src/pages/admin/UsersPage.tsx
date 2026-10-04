import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adminGetUsers, adminCreateUser, adminUpdateUser, adminDeleteUser,
} from '../../api/subsonic';
import { useAuthStore } from '../../store/auth';

export function UsersPage() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPw, setEditPw] = useState('');

  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: adminGetUsers });

  const createMut = useMutation({
    mutationFn: adminCreateUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setCreating(false); setNewUser({ username: '', password: '', role: 'user' }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDeleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const pwMut = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => adminUpdateUser(id, { password }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditingId(null); setEditPw(''); },
  });
  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => adminUpdateUser(id, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-zinc-50">Users</h2>
        <button onClick={() => setCreating(v => !v)} className="bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors">
          + Add user
        </button>
      </div>

      {creating && (
        <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(newUser); }} className="bg-zinc-800 rounded-lg p-4 mb-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">New user</h3>
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Username" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} required className="col-span-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand" />
            <input type="password" placeholder="Password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} required className="col-span-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand" />
            <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} className="col-span-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createMut.isPending} className="bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-1.5 rounded transition-colors disabled:opacity-60">Create</button>
            <button type="button" onClick={() => setCreating(false)} className="text-zinc-400 hover:text-zinc-50 text-sm px-3 py-1.5">Cancel</button>
          </div>
          {createMut.isError && <p className="text-red-400 text-xs">{String(createMut.error)}</p>}
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-zinc-800 rounded animate-pulse" />)}</div>
      ) : (
        <div className="space-y-1">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-4 px-4 py-3 bg-zinc-800/40 rounded-lg group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-50">{u.username} {u.id === me?.id && <span className="text-xs text-zinc-400 ml-1">(you)</span>}</p>
                <p className="text-xs text-zinc-400">{u.role}</p>
              </div>
              {u.id !== me?.id && (
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {editingId === u.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); pwMut.mutate({ id: u.id, password: editPw }); }} className="flex gap-2">
                      <input type="password" placeholder="New password" value={editPw} onChange={e => setEditPw(e.target.value)} className="bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-50 focus:outline-none focus:border-brand" />
                      <button type="submit" className="text-xs text-brand">Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs text-zinc-400">Cancel</button>
                    </form>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(u.id); setEditPw(''); }} className="text-xs text-zinc-400 hover:text-zinc-50 border border-zinc-600 px-2 py-1 rounded transition-colors">Change pw</button>
                      <button onClick={() => roleMut.mutate({ id: u.id, role: u.role === 'admin' ? 'user' : 'admin' })} className="text-xs text-zinc-400 hover:text-zinc-50 border border-zinc-600 px-2 py-1 rounded transition-colors">
                        Make {u.role === 'admin' ? 'user' : 'admin'}
                      </button>
                      <button onClick={() => { if (confirm(`Delete user "${u.username}"?`)) deleteMut.mutate(u.id); }} className="text-xs text-red-500 hover:text-red-400 border border-red-900 px-2 py-1 rounded transition-colors">Delete</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
