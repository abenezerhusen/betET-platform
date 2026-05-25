import React, { useEffect, useState } from 'react';
import { Package, Plus, Check, X, Star, Crown } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as packagesApi from '../../lib/api/packages';
import * as adminGamesApi from '../../lib/api/adminGames';
import { z } from 'zod';

interface PkgClientChip {
  name: string;
  tenant_id?: string | null;
}
interface Pkg {
  id: string;
  name: string;
  tier: 'Starter' | 'Premium' | 'VIP';
  games: string[];
  clients: PkgClientChip[];
  color: string;
}
const packageSchema = z.object({
  name: z.string().trim().min(2, 'Package name is required'),
  tier: z.enum(['Starter', 'Premium', 'VIP']),
  color: z.string().trim().min(1),
  games: z.array(z.string()),
});

export function Packages() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [allGames, setAllGames] = useState<Array<{ id: string; name: string; tags: string[] }>>([]);
  const [clients, setClients] = useState<packagesApi.PackageClient[]>([]);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState('all');
  const [selectedClient, setSelectedClient] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = () => {
    setLoading(true);
    Promise.all([
      packagesApi.listPackages(),
      adminGamesApi.listAdminGamesSimple(),
      packagesApi.listPackageClients().catch(() => [] as packagesApi.PackageClient[]),
    ])
      .then(([pkgs, games, clientList]) => {
        setPackages(
          pkgs.map((p) => ({
            id: p.id,
            name: p.name,
            tier: p.tier,
            games: p.game_ids ?? [],
            clients: (p.assignments ?? []).map((a) => ({
              name: a.client_tenant_name ?? a.client_name,
              tenant_id: a.client_tenant_id ?? null,
            })),
            color: p.color ?? 'gray',
          }))
        );
        setAllGames(
          games.map((g) => ({
            id: g.id,
            name: g.name,
            tags: [
              g.type?.toLowerCase().includes('live') ? 'live' : 'casino',
              g.type?.toLowerCase().includes('slot') ? 'slot' : '',
              g.type?.toLowerCase().includes('crash') ? 'crash' : '',
            ].filter(Boolean),
          }))
        );
        setClients(clientList);
      })
      .catch((err: Error) => toast(`Failed to load packages: ${err.message ?? err}`, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const openEdit = (p: Pkg) => setEditing({ ...p });

  const toggleGame = (gid: string) => {
    if (!editing) return;
    setEditing({
      ...editing,
      games: editing.games.includes(gid) ? editing.games.filter((g) => g !== gid) : [...editing.games, gid],
    });
  };

  const save = () => {
    if (!editing) return;
    const parsed = packageSchema.safeParse(editing);
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Invalid package form', 'error');
      return;
    }
    setSubmitting(true);
    const req =
      editing.id === 'new'
        ? packagesApi.createPackage({
            name: parsed.data.name,
            tier: parsed.data.tier,
            color: parsed.data.color,
            game_ids: parsed.data.games,
          })
        : packagesApi.updatePackage(editing.id, {
            name: parsed.data.name,
            tier: parsed.data.tier,
            color: parsed.data.color,
            game_ids: parsed.data.games,
          });
    req
      .then(() => {
        toast(editing.id === 'new' ? 'Package created.' : 'Package saved.');
        setEditing(null);
        reload();
      })
      .catch((err: Error) => toast(`Failed to save package: ${err.message ?? err}`, 'error'))
      .finally(() => setSubmitting(false));
  };

  const tags = ['all', 'casino', 'live', 'slot', 'crash'];

  const filteredGames = tagFilter === 'all' ? allGames : allGames.filter((g) => g.tags.includes(tagFilter));

  const [selectedAssignPackage, setSelectedAssignPackage] = useState<string>('');

  const handleNewPackage = () => {
    const newPkg: Pkg = {
      id: 'new',
      name: `Custom Package ${packages.length + 1}`,
      tier: 'Starter',
      games: [],
      clients: [],
      color: 'gray',
    };
    setEditing({ ...newPkg });
  };

  const handleAssign = () => {
    if (!selectedClient) {
      toast('Select a client to assign.', 'error');
      return;
    }
    if (!selectedAssignPackage) {
      toast('Select a package to assign.', 'error');
      return;
    }
    // selectedClient is the tenant id when known, otherwise the raw name.
    const matched = clients.find((c) => c.id === selectedClient);
    const payload = matched
      ? { client_name: matched.name, client_tenant_id: matched.id }
      : { client_name: selectedClient };
    packagesApi
      .assignClient(selectedAssignPackage, payload)
      .then(() => {
        toast('Client assigned.');
        setSelectedClient('');
        reload();
      })
      .catch((err: Error) => toast(`Assignment failed: ${err.message ?? err}`, 'error'));
  };

  const tierIcon = (tier: Pkg['tier']) =>
    tier === 'VIP' ? <Crown className="h-5 w-5 text-yellow-600" /> : tier === 'Premium' ? <Star className="h-5 w-5 text-blue-600" /> : <Package className="h-5 w-5 text-gray-600" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Package className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Packages</h1>
        </div>
        <button
          onClick={handleNewPackage}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Package
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {loading && <div className="text-sm text-gray-500">Loading packages…</div>}
        {packages.map((p) => (
          <div key={p.id} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {tierIcon(p.tier)}
                <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
              </div>
              <span
                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                  p.tier === 'VIP'
                    ? 'bg-yellow-100 text-yellow-800'
                    : p.tier === 'Premium'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {p.tier}
              </span>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <p className="text-xs text-gray-500">Games</p>
                <p className="text-2xl font-bold text-gray-900">{p.games.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Assigned Clients</p>
                <div className="flex flex-wrap gap-1">
                  {p.clients.map((c) => (
                    <span
                      key={`${p.id}-${c.tenant_id ?? c.name}`}
                      className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
                    >
                      {c.name}
                    </span>
                  ))}
                  {p.clients.length === 0 && <span className="text-xs text-gray-400">None</span>}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-between">
              <button
                onClick={() => {
                  packagesApi
                    .deletePackage(p.id)
                    .then(() => {
                      toast('Package deleted.');
                      reload();
                    })
                    .catch((err: Error) => toast(`Delete failed: ${err.message ?? err}`, 'error'));
                }}
                className="text-sm font-medium text-red-600 hover:text-red-800"
              >
                Delete
              </button>
              <button onClick={() => openEdit(p)} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                Configure
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Client Assignments</h2>
        </div>
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-4 flex-wrap gap-y-2">
            <label className="text-sm font-medium text-gray-700">Client:</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm min-w-[200px]"
            >
              <option value="">Select a client (white-label tenant)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.current_package ? ` — currently on ${c.current_package.package_name}` : ''}
                </option>
              ))}
            </select>
            <label className="text-sm font-medium text-gray-700 ml-4">Package:</label>
            <select
              value={selectedAssignPackage}
              onChange={(e) => setSelectedAssignPackage(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
            >
              <option value="">Select package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleAssign}
              className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              Assign
            </button>
          </div>
          {clients.length === 0 && (
            <p className="text-xs text-gray-500">
              No client tenants available — create tenants under the Tenants page first.
            </p>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Configure {editing.name}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Package name"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <select
                  value={editing.tier}
                  onChange={(e) => setEditing({ ...editing, tier: e.target.value as Pkg['tier'] })}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="Starter">Starter</option>
                  <option value="Premium">Premium</option>
                  <option value="VIP">VIP</option>
                </select>
                <input
                  type="text"
                  value={editing.color}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  placeholder="Color"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Filter by tag</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTagFilter(t)}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        tagFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-sm font-medium text-gray-700 mb-2">
                Games ({editing.games.length} selected)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredGames.map((g) => {
                  const selected = editing.games.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      onClick={() => toggleGame(g.id)}
                      className={`flex items-center justify-between p-3 rounded-lg border text-left ${
                        selected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{g.name}</p>
                        <div className="flex gap-1 mt-1">
                          {g.tags.map((tag) => (
                            <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      {selected && <Check className="h-5 w-5 text-blue-600 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={submitting}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                {editing.id === 'new' ? 'Create Package' : submitting ? 'Saving…' : 'Save Package'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
