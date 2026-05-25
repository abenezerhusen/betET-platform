import React, { useMemo, useState } from 'react';
import { Shield, ChevronDown, ChevronRight, Search } from 'lucide-react';
import {
  getPermissionsForScope,
  useCustomPermissions,
  type Permission,
  type PermissionScope,
} from '../lib/permissions';

interface PermissionsSelectorProps {
  scope: PermissionScope;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Start collapsed? Defaults to true so "Add" forms stay compact. */
  defaultOpen?: boolean;
  /** Optional title override. */
  title?: string;
  description?: string;
}

export function PermissionsSelector({
  scope,
  value,
  onChange,
  defaultOpen = false,
  title = 'Permissions & Access',
  description,
}: PermissionsSelectorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState('');
  const { custom } = useCustomPermissions();

  const permissions: Permission[] = useMemo(
    () => getPermissionsForScope(scope, custom),
    [scope, custom]
  );

  const categories = useMemo(() => {
    const filtered = permissions.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase())
    );
    const groups: Record<string, Permission[]> = {};
    filtered.forEach((p) => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    });
    return groups;
  }, [permissions, search]);

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const toggleCategory = (cat: string) => {
    const ids = (categories[cat] || []).map((p) => p.id);
    const allOn = ids.every((id) => value.includes(id));
    if (allOn) onChange(value.filter((id) => !ids.includes(id)));
    else onChange([...new Set([...value, ...ids])]);
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center space-x-2">
          <Shield className="h-4 w-4 text-purple-600" />
          <div>
            <p className="text-sm font-medium text-gray-900">{title}</p>
            <p className="text-xs text-gray-500">
              {description ||
                `Select which sections and actions this ${scope.toLowerCase()} can access.`}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
            {value.length} selected
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search permissions..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {value.length} of {permissions.length} enabled
            </span>
            <div className="space-x-2">
              <button
                type="button"
                onClick={() => onChange(permissions.map((p) => p.id))}
                className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
              >
                Clear
              </button>
            </div>
          </div>

          {Object.keys(categories).length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No permissions match your search.
            </p>
          )}

          <div className="space-y-3 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
            {Object.entries(categories).map(([cat, perms]) => {
              const ids = perms.map((p) => p.id);
              const allOn = ids.every((id) => value.includes(id));
              const someOn = ids.some((id) => value.includes(id));
              return (
                <div key={cat} className="bg-gray-50 rounded-lg p-3">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allOn}
                      ref={(input) => {
                        if (input) input.indeterminate = someOn && !allOn;
                      }}
                      onChange={() => toggleCategory(cat)}
                      className="rounded text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm font-semibold text-gray-900">{cat}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {perms.filter((p) => value.includes(p.id)).length}/{perms.length}
                    </span>
                  </label>
                  <div className="mt-2 ml-5 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {perms.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-start space-x-2 p-1.5 hover:bg-white rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={value.includes(p.id)}
                          onChange={() => toggle(p.id)}
                          className="mt-0.5 rounded text-purple-600 focus:ring-purple-500"
                        />
                        <div className="text-xs">
                          <p className="font-medium text-gray-900">{p.name}</p>
                          <p className="text-gray-500">{p.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
