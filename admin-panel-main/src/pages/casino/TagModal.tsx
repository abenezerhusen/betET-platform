import React, { useState } from 'react';
import { X, Upload, Plus, Minus } from 'lucide-react';

interface TagData {
  id: string;
  order: number;
  name: string;
  slug: string;
  status: string;
  phoneTemplate: 'two-columns' | 'three-columns';
  showOnLobby: boolean;
  image: string;
  games: string[];
}

interface TagModalProps {
  isOpen: boolean;
  onClose: () => void;
  tag: TagData | null;
  mode: 'add' | 'edit';
  onSave: (data: TagData) => void;
}

interface GameData {
  id: string;
  name: string;
}

export function TagModal({ isOpen, onClose, tag, mode, onSave }: TagModalProps) {
  const games: GameData[] = [];
  const [formData, setFormData] = useState<TagData | null>(tag);
  const [activeTab, setActiveTab] = useState<'details' | 'games'>('details');
  const [gameSearch, setGameSearch] = useState('');
  const [selectedGame, setSelectedGame] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData) {
      onSave(formData);
    }
    onClose();
  };

  const handleAddGame = () => {
    if (selectedGame && formData) {
      setFormData({
        ...formData,
        games: [...(formData.games || []), selectedGame]
      });
      setSelectedGame('');
    }
  };

  const handleRemoveGame = (gameId: string) => {
    if (formData) {
      setFormData({
        ...formData,
        games: formData.games.filter(id => id !== gameId)
      });
    }
  };

  const filteredGames = games.filter(game => 
    game.name.toLowerCase().includes(gameSearch.toLowerCase())
  );

  const assignedGames = formData?.games?.map(gameId => 
    games.find(g => g.id === gameId)
  ).filter(Boolean) || [];

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">
              {mode === 'add' ? 'Add Tag' : 'Edit Tag'}
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-6">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setActiveTab('details')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'details'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Tag Details
                </button>
                <button
                  onClick={() => setActiveTab('games')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'games'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Assigned Games
                </button>
              </nav>
            </div>
          </div>

          {activeTab === 'details' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Tag Name</label>
                  <input
                    type="text"
                    value={formData?.name || ''}
                    onChange={(e) => setFormData(prev => prev ? {...prev, name: e.target.value} : null)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Slug</label>
                  <input
                    type="text"
                    value={formData?.slug || ''}
                    onChange={(e) => setFormData(prev => prev ? {...prev, slug: e.target.value} : null)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Order</label>
                  <input
                    type="number"
                    value={formData?.order || 0}
                    onChange={(e) => setFormData(prev => prev ? {...prev, order: Number(e.target.value)} : null)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Status</label>
                  <select
                    value={formData?.status || 'Active'}
                    onChange={(e) => setFormData(prev => prev ? {...prev, status: e.target.value} : null)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone Template</label>
                  <select
                    value={formData?.phoneTemplate || 'two-columns'}
                    onChange={(e) => setFormData(prev => prev ? {...prev, phoneTemplate: e.target.value as 'two-columns' | 'three-columns'} : null)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="two-columns">Two Columns</option>
                    <option value="three-columns">Three Columns</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Image</label>
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
                </div>

                <div className="col-span-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData?.showOnLobby || false}
                      onChange={(e) => setFormData(prev => prev ? {...prev, showOnLobby: e.target.checked} : null)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="ml-2">Show on Lobby</span>
                  </label>
                </div>
              </div>

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
                  {mode === 'add' ? 'Create Tag' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="flex space-x-4">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search games..."
                    value={gameSearch}
                    onChange={(e) => setGameSearch(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={selectedGame}
                  onChange={(e) => setSelectedGame(e.target.value)}
                  className="w-64 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select a game</option>
                  {filteredGames.map(game => (
                    <option key={game.id} value={game.id}>{game.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddGame}
                  disabled={!selectedGame}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Game
                </button>
              </div>

              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Game Name
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {assignedGames.map((game) => game && (
                      <tr key={game.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {game.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleRemoveGame(game.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}