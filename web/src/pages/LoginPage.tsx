import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

export function LoginPage() {
  const [serverUrl, setServerUrl] = useState(() => window.location.origin);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  // Set by AccountSettingsPanel after a self-service password change, which
  // invalidates the session that got redirected here.
  const infoMessage = (useLocation().state as { message?: string } | null)?.message;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ serverUrl: serverUrl.replace(/\/$/, ''), username, password });
      navigate('/albums', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-zinc-50 text-center mb-8 tracking-tight">
          <span className="text-brand">RiffPlayer</span>
        </h1>

        {infoMessage && (
          <p className="text-sm text-brand bg-brand/10 px-3 py-2 rounded-lg mb-4 text-center">{infoMessage}</p>
        )}

        <form onSubmit={submit} className="bg-zinc-800/60 rounded-xl p-6 space-y-4 border border-zinc-700/50">
          <div>
            <label htmlFor="login-server-url" className="block text-sm text-zinc-300 mb-1.5">Server URL</label>
            <input
              id="login-server-url"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-brand"
              placeholder="http://localhost:3000"
            />
          </div>

          <div>
            <label htmlFor="login-username" className="block text-sm text-zinc-300 mb-1.5">Username</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-brand"
              placeholder="admin"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm text-zinc-300 mb-1.5">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-brand"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand hover:bg-brand-dim disabled:opacity-60 text-on-brand font-medium py-2 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Connecting…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
