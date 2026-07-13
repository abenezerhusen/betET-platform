import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { Trophy, Plus, Play, Pause, CheckCircle2, XCircle, X } from 'lucide-react';
import { z } from 'zod';
import { toast } from '../../lib/toast';
import * as tournamentsApi from '../../lib/api/tournaments';
import { useAuthStore } from '../../store/auth';

interface TournamentFormData {
  title: string;
  description: string;
  kind: 'sportsbook' | 'casino' | 'streak' | 'jackpot';
  format: 'leaderboard' | 'knockout' | 'jackpot';
  maxEntries: number;
  startDate: string;
  endDate: string;
  entryFee: number;
  prizePool: number;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
}

interface TournamentData {
  id: string;
  title: string;
  type: string;
  format: string;
  startDate: string;
  endDate: string;
  status: string;
  entryFee: number;
  prizePool: number;
  participants: number;
  lastModified: string;
}

const createTournamentSchema = z
  .object({
    title: z.string().trim().min(3, 'Tournament title is required'),
    description: z.string().trim().max(2000).optional(),
    kind: z.enum(['sportsbook', 'casino', 'streak', 'jackpot']),
    format: z.enum(['leaderboard', 'knockout', 'jackpot']),
    maxEntries: z.number().int().min(0, 'Max entries must be zero or positive').optional(),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    entryFee: z.number().min(0, 'Entry fee cannot be negative'),
    prizePool: z.number().positive('Prize pool must be greater than zero'),
    status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled']),
  })
  .refine((d) => new Date(d.endDate).getTime() > new Date(d.startDate).getTime(), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

const CreateTournamentModal = ({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) => {
  const [formData, setFormData] = useState<TournamentFormData>({
    title: '',
    description: '',
    kind: 'sportsbook',
    format: 'leaderboard',
    maxEntries: 0,
    startDate: '',
    endDate: '',
    entryFee: 0,
    prizePool: 0,
    status: 'draft',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const parsed = createTournamentSchema.safeParse(formData);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid tournament data');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await tournamentsApi.createTournament({
        name: parsed.data.title,
        description: parsed.data.description || undefined,
        kind: parsed.data.kind,
        status: parsed.data.status,
        starts_at: new Date(parsed.data.startDate).toISOString(),
        ends_at: new Date(parsed.data.endDate).toISOString(),
        entry_fee: parsed.data.entryFee,
        prize_pool: parsed.data.prizePool,
        currency: 'ETB',
        max_entries: parsed.data.maxEntries && parsed.data.maxEntries > 0 ? parsed.data.maxEntries : undefined,
        rules: { format: parsed.data.format },
      });
      toast('Tournament created.');
      onCreated();
      onClose();
    } catch (err) {
      toast(`Failed to create tournament: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Create New Tournament</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-2 text-sm rounded border border-red-200 bg-red-50 text-red-700">
                {error}
              </div>
            )}
            <input
              type="text"
              placeholder="Tournament title"
              value={formData.title}
              onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))}
              className="w-full rounded-md border-gray-300"
              required
            />
            <textarea
              placeholder="Description"
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              className="w-full rounded-md border-gray-300"
              rows={3}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Type (product)</label>
                <select
                  value={formData.kind}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, kind: e.target.value as TournamentFormData['kind'] }))
                  }
                  className="w-full rounded-md border-gray-300"
                >
                  <option value="sportsbook">sportsbook</option>
                  <option value="casino">casino</option>
                  <option value="streak">streak</option>
                  <option value="jackpot">jackpot</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Format</label>
                <select
                  value={formData.format}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, format: e.target.value as TournamentFormData['format'] }))
                  }
                  className="w-full rounded-md border-gray-300"
                >
                  <option value="leaderboard">Leaderboard</option>
                  <option value="knockout">Knockout</option>
                  <option value="jackpot">Jackpot</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, status: e.target.value as TournamentFormData['status'] }))
                  }
                  className="w-full rounded-md border-gray-300"
                >
                  <option value="draft">draft</option>
                  <option value="scheduled">scheduled</option>
                  <option value="running">running</option>
                  <option value="paused">paused</option>
                  <option value="completed">completed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Max Players (0 = unlimited)</label>
                <input
                  type="number"
                  value={formData.maxEntries}
                  onChange={(e) => setFormData((p) => ({ ...p, maxEntries: Number(e.target.value) }))}
                  className="w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                <input
                  type="datetime-local"
                  value={formData.startDate}
                  onChange={(e) => setFormData((p) => ({ ...p, startDate: e.target.value }))}
                  className="w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">End Date</label>
                <input
                  type="datetime-local"
                  value={formData.endDate}
                  onChange={(e) => setFormData((p) => ({ ...p, endDate: e.target.value }))}
                  className="w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Entry Fee (ETB)</label>
                <input
                  type="number"
                  value={formData.entryFee}
                  onChange={(e) => setFormData((p) => ({ ...p, entryFee: Number(e.target.value) }))}
                  className="w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Prize Pool (ETB)</label>
                <input
                  type="number"
                  value={formData.prizePool}
                  onChange={(e) => setFormData((p) => ({ ...p, prizePool: Number(e.target.value) }))}
                  className="w-full rounded-md border-gray-300"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md">
                {saving ? 'Creating...' : 'Create Tournament'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

function mapTournament(
  t: tournamentsApi.Tournament,
  participantCount: number
): TournamentData {
  return {
    id: t.id,
    title: t.name,
    type: t.kind ?? t.game_type ?? '—',
    format:
      ((t.rules as Record<string, unknown>)?.format as string | undefined) ?? 'leaderboard',
    startDate: t.starts_at ? new Date(t.starts_at).toLocaleString() : '—',
    endDate: t.ends_at ? new Date(t.ends_at).toLocaleString() : '—',
    status: t.status,
    entryFee: Number(t.entry_fee ?? t.buy_in ?? 0),
    prizePool: Number(t.prize_pool ?? 0),
    participants: participantCount,
    lastModified: t.updated_at ? new Date(t.updated_at).toLocaleString() : '—',
  };
}

export function ManageTournaments() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [rows, setRows] = useState<TournamentData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const res = await tournamentsApi.listTournaments({
        status: selectedStatus || undefined,
        limit: 120,
      });
      const items = res.items ?? [];
      const withEntries = await Promise.all(
        items.map(async (t) => {
          try {
            const lb = await tournamentsApi.getTournamentLeaderboard(t.id);
            return mapTournament(t, (lb.items ?? []).length);
          } catch {
            return mapTournament(t, 0);
          }
        })
      );
      setRows(withEntries);
    } catch (err) {
      toast(`Failed to load tournaments: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isAuth, selectedStatus]);

  const activate = async (id: string) => {
    try {
      await tournamentsApi.setTournamentStatus(id, 'running');
      toast('Tournament activated.');
      await load();
    } catch (err) {
      toast(`Activate failed: ${(err as Error).message}`, 'error');
    }
  };

  const pause = async (id: string) => {
    try {
      await tournamentsApi.setTournamentStatus(id, 'paused');
      toast('Tournament paused.');
      await load();
    } catch (err) {
      toast(`Pause failed: ${(err as Error).message}`, 'error');
    }
  };

  const completeNow = async (id: string) => {
    if (!window.confirm('Complete this tournament and distribute prizes?')) return;
    try {
      const res = await tournamentsApi.completeTournament(id);
      toast(`Tournament completed — ${res.payouts.length} winner(s) paid.`);
      await load();
    } catch (err) {
      toast(`Complete failed: ${(err as Error).message}`, 'error');
    }
  };

  const cancelTournament = async (id: string) => {
    if (!window.confirm('Cancel this tournament?')) return;
    try {
      await tournamentsApi.setTournamentStatus(id, 'cancelled');
      toast('Tournament cancelled.');
      await load();
    } catch (err) {
      toast(`Cancel failed: ${(err as Error).message}`, 'error');
    }
  };

  const filters = [
    {
      label: 'Format',
      options: ['leaderboard', 'knockout', 'jackpot'],
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const data = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!selectedType || r.format.toLowerCase() === selectedType.toLowerCase()) &&
          (!selectedStatus ||
            r.status.toLowerCase() === selectedStatus.toLowerCase())
      ),
    [rows, selectedType, selectedStatus]
  );

  const columns = [
    { header: 'Title', accessor: 'title' as const },
    { header: 'Type', accessor: 'type' as const },
    { header: 'Format', accessor: 'format' as const },
    { header: 'Start Date', accessor: 'startDate' as const },
    { header: 'End Date', accessor: 'endDate' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Entry Fee', accessor: 'entryFee' as const },
    { header: 'Prize Pool', accessor: 'prizePool' as const },
    { header: 'Participants', accessor: 'participants' as const },
    { header: 'Last Modified', accessor: 'lastModified' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (id: string) => {
        const row = rows.find((r) => r.id === id);
        if (!row) return null;
        const canActivate = ['draft', 'scheduled', 'paused'].includes(row.status);
        const canPause = row.status === 'running';
        const canComplete = ['running', 'paused', 'scheduled'].includes(row.status);
        const canCancel = !['completed', 'cancelled'].includes(row.status);
        return (
          <div className="flex items-center gap-3">
            {canActivate && (
              <button
                onClick={() => void activate(id)}
                title="Activate"
                className="text-green-600 hover:text-green-800"
              >
                <Play className="h-4 w-4" />
              </button>
            )}
            {canPause && (
              <button
                onClick={() => void pause(id)}
                title="Pause"
                className="text-yellow-600 hover:text-yellow-800"
              >
                <Pause className="h-4 w-4" />
              </button>
            )}
            {canComplete && (
              <button
                onClick={() => void completeNow(id)}
                title="Complete (settle prizes)"
                className="text-blue-600 hover:text-blue-800"
              >
                <CheckCircle2 className="h-4 w-4" />
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => void cancelTournament(id)}
                title="Cancel"
                className="text-red-600 hover:text-red-800"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Trophy className="h-8 w-8 text-yellow-500" />
          <h1 className="text-2xl font-semibold text-gray-900">Manage Tournaments</h1>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Tournament
        </button>
      </div>

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setSelectedType('');
          setSelectedStatus('');
          setStartDate(new Date());
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <DataTable columns={columns} data={data} />
        {loading && <div className="px-6 pb-6 text-sm text-gray-500">Loading tournaments…</div>}
      </div>

      <CreateTournamentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}
