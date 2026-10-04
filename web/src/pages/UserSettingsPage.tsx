import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { patchMyPreferences, changeMyPassword } from '../api/subsonic';
import { useAuthStore } from '../store/auth';
import { useDownloadsStore, type DownloadTarget } from '../store/downloads';
import { DeviceNameSection } from '../components/DeviceNameSection';
import { AppearanceSection } from '../components/AppearanceSection';
import { PlaybackSection } from '../components/PlaybackSection';
import { ProfileSection } from '../components/ProfileSection';
import { LinkedDevicesSection } from '../components/LinkedDevicesSection';
import { EqualizerSection } from '../components/EqualizerSection';

// Fetch current user preferences via /api/v1/users/me
async function fetchMe() {
  const { useAuthStore: _s } = await import('../store/auth');
  const { token, credentials } = _s.getState();
  if (!credentials) throw new Error('Not authenticated');
  const base = credentials.serverUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}/api/v1/users/me`, { headers });
  if (!res.ok) throw new Error('Failed to load preferences');
  return res.json() as Promise<{
    id: number; username: string; role: string;
    preferences: {
      transcode_format: string | null;
      transcode_bitrate: number | null;
      lastfm_session_key: string | null;
      listenbrainz_token: string | null;
    } | null;
  }>;
}

export function UserSettingsPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-zinc-50 mb-6">Settings</h1>
      <div className="flex gap-1 mb-8 border-b border-zinc-800">
        <NavLink
          to="/settings"
          end
          className={({ isActive }) =>
            `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive ? 'border-brand text-brand' : 'border-transparent text-zinc-400 hover:text-zinc-50'
            }`
          }
        >
          Account
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink
            to="/settings/admin"
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive ? 'border-brand text-brand' : 'border-transparent text-zinc-400 hover:text-zinc-50'
              }`
            }
          >
            Admin
          </NavLink>
        )}
      </div>
      <Outlet />
    </div>
  );
}

export function AccountSettingsPanel() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { data, isLoading } = useQuery({ queryKey: ['user-me'], queryFn: fetchMe });
  const mut = useMutation({
    mutationFn: patchMyPreferences,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-me'] }),
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const passwordMut = useMutation({
    mutationFn: () => changeMyPassword(currentPassword, newPassword),
    onSuccess: () => {
      // Changing your own password bumps token_version server-side, which
      // invalidates this session's JWT (and the Subsonic credentials cached
      // here, since they're now the old password) immediately — staying
      // "logged in" past this point would just mean every next request
      // starts failing with 401s. Send the user to sign in again instead.
      logout();
      navigate('/login', { replace: true, state: { message: 'Password changed — sign in with your new password.' } });
    },
  });

  const submitPasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMismatch(false);
    if (newPassword !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }
    passwordMut.mutate();
  };

  const defaultTarget = useDownloadsStore((s) => s.defaultTarget);
  const setDefaultTarget = useDownloadsStore((s) => s.setDefaultTarget);

  const prefs = data?.preferences;
  const [fmt, setFmt] = useState('');
  const [bitrate, setBitrate] = useState('');
  const [lbToken, setLbToken] = useState('');
  const [lfmKey, setLfmKey] = useState('');

  // Initialise from server data on first load
  const [init, setInit] = useState(false);
  if (prefs !== undefined && !init) {
    setFmt(prefs?.transcode_format ?? '');
    setBitrate(prefs?.transcode_bitrate ? String(prefs.transcode_bitrate) : '');
    setLbToken(prefs?.listenbrainz_token ?? '');
    setLfmKey(prefs?.lastfm_session_key ?? '');
    setInit(true);
  }

  if (isLoading) return <div className="text-zinc-400 text-sm">Loading…</div>;

  return (
    <div className="max-w-lg space-y-8">
      <p className="text-sm text-zinc-400 -mt-2">Signed in as {user?.username}</p>

      <ProfileSection />

      <AppearanceSection />

      <PlaybackSection />

      <EqualizerSection />

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Password</h2>
        <form onSubmit={submitPasswordChange} className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand"
          />
          {passwordMismatch && <p className="text-red-400 text-sm">New passwords don't match.</p>}
          {passwordMut.isError && (
            <p className="text-red-400 text-sm">{(passwordMut.error as Error).message}</p>
          )}
          <button
            type="submit"
            disabled={passwordMut.isPending}
            className="bg-brand hover:bg-brand-dim disabled:opacity-60 text-on-brand text-sm px-4 py-2 rounded-lg transition-colors"
          >
            {passwordMut.isPending ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Transcoding</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Set a preferred format/bitrate for mobile data saving. Leave blank to stream originals.
        </p>
        <div className="flex gap-3">
          <select value={fmt} onChange={e => setFmt(e.target.value)} className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand">
            <option value="">Original format</option>
            <option value="mp3">MP3</option>
            <option value="aac">AAC</option>
            <option value="opus">Opus</option>
            <option value="ogg">OGG Vorbis</option>
          </select>
          <select value={bitrate} onChange={e => setBitrate(e.target.value)} className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand">
            <option value="">No limit</option>
            <option value="64">64 kbps</option>
            <option value="128">128 kbps</option>
            <option value="192">192 kbps</option>
            <option value="256">256 kbps</option>
            <option value="320">320 kbps</option>
          </select>
        </div>
        <button
          onClick={() => mut.mutate({ transcode_format: fmt || null, transcode_bitrate: bitrate ? Number(bitrate) : null })}
          className="mt-3 bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Save transcoding
        </button>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Downloads</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Where "Download" sends tracks and playlists by default. This only applies on this device
          — it isn't synced to your account.
        </p>
        <select
          value={defaultTarget}
          onChange={(e) => setDefaultTarget(e.target.value as DownloadTarget)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand"
        >
          <option value="ask">Always ask</option>
          <option value="app">In RiffPlayer (offline playback)</option>
          <option value="device">This device's Downloads folder</option>
        </select>
      </section>

      <DeviceNameSection />

      <LinkedDevicesSection />

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">ListenBrainz</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Paste your token from <a href="https://listenbrainz.org/profile/" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">listenbrainz.org/profile</a>.
        </p>
        <input value={lbToken} onChange={e => setLbToken(e.target.value)} placeholder="ListenBrainz user token" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand" />
        <button onClick={() => mut.mutate({ listenbrainz_token: lbToken || null })} className="mt-3 bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors">
          Save ListenBrainz
        </button>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Last.fm</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Paste your Last.fm session key (obtain via Last.fm API auth flow or a tool like <code className="text-zinc-300">lastfm-session-key</code>).
        </p>
        <input value={lfmKey} onChange={e => setLfmKey(e.target.value)} placeholder="Last.fm session key" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand" />
        <button onClick={() => mut.mutate({ lastfm_session_key: lfmKey || null })} className="mt-3 bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors">
          Save Last.fm
        </button>
      </section>

      {mut.isSuccess && <p className="text-green-400 text-sm">Saved.</p>}
      {mut.isError && <p className="text-red-400 text-sm">Save failed.</p>}
    </div>
  );
}
