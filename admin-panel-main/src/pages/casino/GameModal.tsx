import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';

interface GameData {
  id: string;
  order: number;
  name: string;
  label: string;
  description: string;
  status: string;
  provider: string;
  categories: string[];
  tags: string[];
  weight: number;
  logo: string;
  slug: string;
  labelBackground: string;
}

interface GameModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: GameData | null;
  mode: 'view' | 'edit';
  onSave?: (data: GameData) => void;
}

export function GameModal({ isOpen, onClose, game, mode, onSave }: GameModalProps) {
  const [formData, setFormData] = useState<GameData | null>(game);

  if (!isOpen || !game) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'edit' && onSave && formData) {
      onSave(formData);
    }
    onClose();
  };

  const isReadOnly = mode === 'view';

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">
              {mode === 'view' ? 'Game Details' : 'Edit Game'}
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={formData?.name || ''}
                  onChange={(e) => setFormData(prev => prev ? {...prev, name: e.target.value} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Label</label>
                <input
                  type="text"
                  value={formData?.label || ''}
                  onChange={(e) => setFormData(prev => prev ? {...prev, label: e.target.value} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={formData?.status || ''}
                  onChange={(e) => setFormData(prev => prev ? {...prev, status: e.target.value} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  disabled={isReadOnly}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Weight</label>
                <input
                  type="number"
                  value={formData?.weight || 0}
                  onChange={(e) => setFormData(prev => prev ? {...prev, weight: Number(e.target.value)} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Order</label>
                <input
                  type="number"
                  value={formData?.order || 0}
                  onChange={(e) => setFormData(prev => prev ? {...prev, order: Number(e.target.value)} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Slug</label>
                <input
                  type="text"
                  value={formData?.slug || ''}
                  onChange={(e) => setFormData(prev => prev ? {...prev, slug: e.target.value} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={formData?.description || ''}
                  onChange={(e) => setFormData(prev => prev ? {...prev, description: e.target.value} : null)}
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">Logo</label>
                {isReadOnly ? (
                  <img 
                    src={formData?.logo} 
                    alt={formData?.name} 
                    className="mt-1 h-48 w-full object-cover rounded-lg"
                  />
                ) : (
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg">
                    <div className="space-y-1 text-center">
                      <Upload className="mx-auto h-12 w-12 text-gray-400" />
                      <div className="flex text-sm text-gray-600">
                        <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500">
                          <span>Upload a file</span>
                          <input type="file" className="sr-only" />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Label Background</label>
                <input
                  type="text"
                  value={formData?.labelBackground || ''}
                  onChange={(e) => setFormData(prev => prev ? {...prev, labelBackground: e.target.value} : null)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  readOnly={isReadOnly}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Categories</label>
                <select
                  multiple
                  value={formData?.categories || []}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions, option => option.value);
                    setFormData(prev => prev ? {...prev, categories: values} : null);
                  }}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  disabled={isReadOnly}
                >
                  <option value="Slots">Slots</option>
                  <option value="Live Casino">Live Casino</option>
                  <option value="Table Games">Table Games</option>
                  <option value="Featured">Featured</option>
                </select>
              </div>
            </div>

            {!isReadOnly && (
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}