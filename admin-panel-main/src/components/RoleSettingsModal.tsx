import React, { useMemo, useState } from 'react';
import { X, Shield, Plus, Trash2 } from 'lucide-react';
import {
  getPermissionsForScope,
  useCustomPermissions,
  type Permission,
  type PermissionScope,
} from '../lib/permissions';

interface RoleSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (permissions: string[]) => void;
  userType: string;
  currentPermissions?: string[];
}

function toScope(userType: string): PermissionScope | null {
  switch (userType) {
    case 'Super Admin':
      return 'Super Admin';
    case 'Administrator':
      return 'Administrator';
    case 'Agent':
      return 'Agent';
    case 'Branch':
      return 'Branch';
    case 'Sales Staff':
      return 'Sales Staff';
    case 'Operator':
      return 'Operator';
    default:
      return null;
  }
}

export function RoleSettingsModal({
  isOpen,
  onClose,
  onSave,
  userType,
  currentPermissions = [],
}: RoleSettingsModalProps) {
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(currentPermissions);
  const [searchTerm, setSearchTerm] = useState('');

  // Custom permission form (super admin only — appears for Administrator / Super Admin / Agent)
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newPerm, setNewPerm] = useState({ name: '', description: '', category: '' });

  const { custom, addCustom, removeCustom } = useCustomPermissions();

  const scope = toScope(userType);

  const permissions: Permission[] = useMemo(
    () => (scope ? getPermissionsForScope(scope, custom) : []),
    [scope, custom]
  );

  if (!isOpen) return null;

  const canExtendCatalog =
    userType === 'Administrator' ||
    userType === 'Super Admin' ||
    userType === 'Agent' ||
    userType === 'Operator';

  const filteredPermissions = permissions.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredCategories = Array.from(new Set(filteredPermissions.map((p) => p.category)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(selectedPermissions);
    onClose();
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId]
    );
  };

  const toggleCategory = (category: string) => {
    const categoryPermissions = permissions.filter((p) => p.category === category).map((p) => p.id);
    const allSelected = categoryPermissions.every((id) => selectedPermissions.includes(id));
    if (allSelected) {
      setSelectedPermissions((prev) => prev.filter((id) => !categoryPermissions.includes(id)));
    } else {
      setSelectedPermissions((prev) => [...new Set([...prev, ...categoryPermissions])]);
    }
  };

  const handleAddCustom = () => {
    if (!scope) return;
    if (!newPerm.name.trim() || !newPerm.category.trim()) return;
    addCustom({
      name: newPerm.name.trim(),
      description: newPerm.description.trim() || `Custom permission: ${newPerm.name.trim()}`,
      category: newPerm.category.trim(),
      scopes: [scope],
    });
    setNewPerm({ name: '', description: '', category: '' });
    setShowAddCustom(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-full max-w-[800px] mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-4">
          <div className="flex items-center space-x-2">
            <Shield className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold">Role Settings - {userType}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search permissions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center justify-between mb-4 text-xs text-gray-500">
          <span>
            {selectedPermissions.length} of {permissions.length} permissions enabled
          </span>
          <div className="space-x-2">
            <button
              type="button"
              onClick={() => setSelectedPermissions(permissions.map((p) => p.id))}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => setSelectedPermissions([])}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {filteredCategories.map((category) => {
            const categoryPermissions = filteredPermissions.filter((p) => p.category === category);
            const allSelected = categoryPermissions.every((p) => selectedPermissions.includes(p.id));
            const someSelected = categoryPermissions.some((p) => selectedPermissions.includes(p.id));

            return (
              <div key={category} className="space-y-4 bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => toggleCategory(category)}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <h3 className="font-medium text-gray-900">{category}</h3>
                  <span className="text-xs text-gray-500 ml-auto">
                    {categoryPermissions.filter((p) => selectedPermissions.includes(p.id)).length}/
                    {categoryPermissions.length}
                  </span>
                </div>
                <div className="space-y-2 ml-6">
                  {categoryPermissions.map((permission) => {
                    const isCustom = custom.some((c) => c.id === permission.id);
                    return (
                      <label
                        key={permission.id}
                        className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(permission.id)}
                          onChange={() => togglePermission(permission.id)}
                          className="rounded text-purple-600 focus:ring-purple-500"
                        />
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 flex items-center">
                            {permission.name}
                            {isCustom && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">
                                CUSTOM
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500">{permission.description}</p>
                        </div>
                        {isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              removeCustom(permission.id);
                              setSelectedPermissions((prev) =>
                                prev.filter((id) => id !== permission.id)
                              );
                            }}
                            className="p-1 rounded text-red-500 hover:bg-red-50"
                            title="Remove custom permission"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {filteredPermissions.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-6">
              No permissions match your search.
            </p>
          )}

          {canExtendCatalog && (
            <div className="border-t border-gray-200 pt-4">
              {!showAddCustom ? (
                <button
                  type="button"
                  onClick={() => setShowAddCustom(true)}
                  className="inline-flex items-center text-sm font-medium text-purple-600 hover:text-purple-800"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add custom permission
                </button>
              ) : (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-purple-900">
                    New custom permission for {userType}
                  </h4>
                  <p className="text-xs text-purple-800">
                    Add a permission not yet in the system catalog. It will become available
                    immediately for every {userType} role settings screen.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Permission Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newPerm.name}
                        onChange={(e) => setNewPerm({ ...newPerm, name: e.target.value })}
                        placeholder="e.g. Export Compliance Report"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Category <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newPerm.category}
                        onChange={(e) => setNewPerm({ ...newPerm, category: e.target.value })}
                        placeholder="e.g. Reports"
                        list="permission-categories"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                      <datalist id="permission-categories">
                        {Array.from(new Set(permissions.map((p) => p.category))).map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={newPerm.description}
                        onChange={(e) =>
                          setNewPerm({ ...newPerm, description: e.target.value })
                        }
                        placeholder="Short explanation of what this permission unlocks"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddCustom(false);
                        setNewPerm({ name: '', description: '', category: '' });
                      }}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAddCustom}
                      disabled={!newPerm.name.trim() || !newPerm.category.trim()}
                      className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add permission
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end space-x-3 sticky bottom-0 bg-white py-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
