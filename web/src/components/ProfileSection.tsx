import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteAvatar, getMyProfile, getSocialStatus, updateMyProfile, uploadAvatar } from '../api/subsonic';
import { useAuthStore } from '../store/auth';
import { Avatar } from './Avatar';

/** Profile settings: name, bio, picture, and the opt-in "show what I'm listening to". */
export function ProfileSection() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: enabled } = useQuery({ queryKey: ['social-status'], queryFn: getSocialStatus });
  const { data: profile } = useQuery({ queryKey: ['my-profile'], queryFn: getMyProfile });
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.displayName ?? '');
      setBio(profile.bio ?? '');
    }
  }, [profile]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-profile'] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };
  const save = useMutation({
    mutationFn: () => updateMyProfile({ displayName: name.trim() || null, bio: bio.trim() || null }),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const share = useMutation({
    mutationFn: (v: boolean) => updateMyProfile({ showListening: v }),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const upload = useMutation({
    mutationFn: (f: File) => uploadAvatar(f),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({ mutationFn: deleteAvatar, onSuccess: refresh });

  if (!profile || !user) return null;
  const shownName = profile.displayName || user.username;

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Profile</h2>
      {enabled === false && (
        <p className="text-xs text-zinc-500 mb-3">An admin has turned social features off on this server, so others can&apos;t see your profile.</p>
      )}

      <div className="flex items-center gap-4 mb-4">
        <Avatar userId={user.id} name={shownName} hasAvatar={profile.hasAvatar} version={profile.avatarVersion} size={72} />
        <div className="flex flex-col items-start gap-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            aria-label="Upload picture"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-brand hover:underline">
            {profile.hasAvatar ? 'Change picture' : 'Add a picture'}
          </button>
          {profile.hasAvatar && (
            <button type="button" onClick={() => remove.mutate()} className="text-xs text-zinc-400 hover:text-red-400">
              Remove picture
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 max-w-md">
        <label className="block text-sm text-zinc-50">
          Display name
          <input
            value={name}
            maxLength={40}
            placeholder={user.username}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm text-zinc-50">
          About you
          <textarea
            value={bio}
            maxLength={200}
            rows={2}
            onChange={(e) => setBio(e.target.value)}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm resize-none"
          />
        </label>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-50"
        >
          Save profile
        </button>
      </div>

      <div className="mt-6 flex items-start gap-3 max-w-md">
        <input
          id="show-listening"
          type="checkbox"
          checked={profile.showListening}
          onChange={(e) => share.mutate(e.target.checked)}
          className="mt-1 accent-brand"
        />
        <label htmlFor="show-listening" className="text-sm text-zinc-50">
          Show what I&apos;m listening to
          <span className="block text-xs text-zinc-400 mt-0.5">
            Off by default. When on, other people on this server can see the song you are playing right now. Only your
            public playlists are ever visible to others; private ones stay private. (The server admin can already read the
            play history stored on their own server — this doesn&apos;t change that.)
          </span>
        </label>
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </section>
  );
}
