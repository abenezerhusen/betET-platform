import React, { useEffect } from 'react';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { toast } from '../lib/toast';

export function Header() {
  const logout = useAuthStore((state) => state.logout);
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    if (!accessToken || typeof window === 'undefined') return;
    try {
      const payload = JSON.parse(window.atob(accessToken.split('.')[1] ?? ''));
      const exp =
        typeof payload?.exp === 'number' ? payload.exp * 1000 : 0;
      if (!exp) return;
      const warnAt = exp - 5 * 60 * 1000;
      const timeout = window.setTimeout(() => {
        toast('Your session expires in 5 minutes. Save your work.', 'info');
      }, Math.max(0, warnAt - Date.now()));
      return () => window.clearTimeout(timeout);
    } catch {
      return;
    }
  }, [accessToken]);

  return (
    <header className="bg-white border-b border-gray-200 h-16 flex items-center px-6 justify-between">
      <div className="flex items-center space-x-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-extrabold tracking-tight bg-emerald-500 text-black"
            aria-hidden
          >
            1B
          </span>
          <span className="text-base font-bold tracking-tight text-gray-900">
            1birr<span className="text-emerald-600">.bet</span>
          </span>
          <span className="hidden sm:inline text-gray-300">|</span>
          <h1 className="hidden sm:inline text-xl font-semibold text-gray-800">
            Admin Dashboard
          </h1>
        </div>
      </div>
      <button
        onClick={logout}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
      >
        <LogOut size={20} />
        <span>Logout</span>
      </button>
    </header>
  );
}