import React, { useEffect } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { toast } from '../lib/toast';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
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
    <header className="bg-white border-b border-gray-200 h-14 md:h-16 flex items-center px-3 md:px-6 justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-1 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Open navigation menu"
          >
            <Menu size={22} />
          </button>
        )}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-extrabold tracking-tight bg-emerald-500 text-black shrink-0"
            aria-hidden
          >
            1B
          </span>
          <span className="text-base font-bold tracking-tight text-gray-900 truncate">
            1birr<span className="text-emerald-600">.bet</span>
          </span>
          <span className="hidden sm:inline text-gray-300">|</span>
          <h1 className="hidden sm:inline text-xl font-semibold text-gray-800 truncate">
            Admin Dashboard
          </h1>
        </div>
      </div>
      <button
        onClick={logout}
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 shrink-0"
      >
        <LogOut size={20} />
        <span className="hidden sm:inline">Logout</span>
      </button>
    </header>
  );
}
