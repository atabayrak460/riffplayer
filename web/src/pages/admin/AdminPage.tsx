import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';

const TABS = [
  { to: '/settings/admin/users', label: 'Users' },
  { to: '/settings/admin/libraries', label: 'Libraries' },
  { to: '/settings/admin/settings', label: 'Settings' },
];

export function AdminPage() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') return <Navigate to="/albums" replace />;

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {TABS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-brand text-brand'
                  : 'border-transparent text-zinc-400 hover:text-zinc-50'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
