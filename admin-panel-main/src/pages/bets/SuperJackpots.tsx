/**
 * /bets/super-jackpots — Section 4 page.
 *
 * Three tabs:
 *   1. Super Jackpots          GET  /api/admin/jackpots
 *   2. Online Jackpot Tickets  GET  /api/admin/jackpots/:id/tickets?type=online
 *   3. Offline Jackpot Tickets GET  /api/admin/jackpots/:id/tickets?type=offline
 *
 * Actions:
 *   - Create Jackpot           POST /api/admin/jackpots
 *   - Settle Jackpot           PATCH /api/admin/jackpots/:id/settle
 *   - Delete Jackpot           DELETE /api/admin/jackpots/:id  (no tickets sold)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { TabGroup } from '../../components/TabGroup';
import {
  Trophy,
  Plus,
  X,
  Award,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as jackpotsApi from '../../lib/api/jackpots';
import * as sportsbookApi from '../../lib/api/sportsbook';
import { useAuthStore } from '../../store/auth';

interface JackpotRow {
  id: string;
  name: string;
  description: string;
  status: string;
  entry_fee: number;
  prize_pool: number;
  currency: string;
  starts_at: string;
  ends_at: string;
  events: number;
  tickets: number;
  raw: jackpotsApi.AdminJackpot;
}

interface TicketRow {
  id: string;
  date: string;
  ticketId: string;
  user: string;
  phone: string;
  cashier: string;
  branch: string;
  jackpotName: string;
  stake: number;
  status: string;
  selections: string;
  payout: number;
  raw: jackpotsApi.JackpotTicket;
}

const num = (s: string | number | null | undefined): number =>
  typeof s === 'number' ? s : Number(s ?? 0);

function toJackpotRow(j: jackpotsApi.AdminJackpot): JackpotRow {
  const events = Array.isArray(j.rules?.event_ids) ? j.rules.event_ids.length : 0;
  return {
    id: j.id,
    name: j.name,
    description: j.description ?? (j.rules?.description as string | undefined) ?? '',
    status: j.status,
    entry_fee: num(j.entry_fee),
    prize_pool: num(j.prize_pool),
    currency: j.currency,
    starts_at: j.starts_at ? new Date(j.starts_at).toLocaleString() : '—',
    ends_at: j.ends_at ? new Date(j.ends_at).toLocaleString() : '—',
    events,
    tickets: Number(j.tickets_count ?? 0),
    raw: j,
  };
}

function toTicketRow(t: jackpotsApi.JackpotTicket): TicketRow {
  return {
    id: t.id,
    date: t.placed_at ? new Date(t.placed_at).toLocaleString() : '—',
    ticketId: t.id.slice(0, 8),
    user: t.user_name ?? t.user_email ?? '—',
    phone: t.user_phone ?? t.bet_for_user_phone ?? '—',
    cashier: String(
      (t.metadata?.cashier_name as string | undefined) ?? '—'
    ),
    branch: String(
      (t.metadata?.branch_name as string | undefined) ??
        (t.metadata?.branch_id as string | undefined) ??
        '—'
    ),
    jackpotName: t.jackpot_name ?? '—',
    stake: num(t.stake),
    status: t.status,
    selections: `${t.won_legs}/${t.leg_count}`,
    payout: num(t.actual_payout),
    raw: t,
  };
}

const CreateJackpotModal = ({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entryFee, setEntryFee] = useState<number>(0);
  const [prizePool, setPrizePool] = useState<number>(0);
  const [currency, setCurrency] = useState('ETB');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [events, setEvents] = useState<sportsbookApi.SportEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setEventsLoading(true);
    sportsbookApi
      .listEvents({ status: 'scheduled', limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.items ?? []);
      })
      .catch((err: Error) =>
        toast(`Failed to load events: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const reset = () => {
    setName('');
    setDescription('');
    setEntryFee(0);
    setPrizePool(0);
    setCurrency('ETB');
    setStartsAt('');
    setEndsAt('');
    setSelected(new Set());
  };

  const toggleEvent = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast('Name is required.', 'error');
      return;
    }
    if (selected.size === 0) {
      toast('Select at least one match.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await jackpotsApi.createJackpot({
        name: name.trim(),
        description: description.trim() || undefined,
        entry_fee: entryFee,
        prize_pool: prizePool,
        currency,
        starts_at: startsAt ? new Date(startsAt).toISOString() : undefined,
        ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
        event_ids: Array.from(selected),
        status: 'scheduled',
      });
      toast('Jackpot created.');
      reset();
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create jackpot';
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Create New Jackpot</h2>
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
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Currency</label>
                <input
                  type="text"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Entry Fee</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={entryFee}
                  onChange={(e) => setEntryFee(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Prize Pool</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prizePool}
                  onChange={(e) => setPrizePool(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Activation Date</label>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">End Date (optional)</label>
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div>
              <h3 className="text-md font-medium text-gray-900 mb-2">
                Select Matches{' '}
                <span className="text-sm text-gray-500">({selected.size} selected)</span>
              </h3>
              <div className="border rounded-md max-h-60 overflow-y-auto divide-y">
                {eventsLoading ? (
                  <div className="p-4 text-sm text-gray-500">Loading events…</div>
                ) : events.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">
                    No scheduled events available. Create some in Sportsbook → Events first.
                  </div>
                ) : (
                  events.map((ev) => (
                    <label
                      key={ev.id}
                      className={`flex items-center p-3 cursor-pointer ${
                        selected.has(ev.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(ev.id)}
                        onChange={() => toggleEvent(ev.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {ev.home_team} vs {ev.away_team}
                        </p>
                        <p className="text-xs text-gray-500">
                          {ev.league ?? ev.sport} ·{' '}
                          {new Date(ev.starts_at).toLocaleString()}
                        </p>
                      </div>
                    </label>
                  ))
                )}
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
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create Jackpot'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export function SuperJackpots() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView = role === 'admin' || role === 'superadmin';

  const [activeTab, setActiveTab] = useState<'jackpots' | 'online' | 'offline'>(
    'jackpots'
  );
  const [jackpots, setJackpots] = useState<JackpotRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [selectedJackpotId, setSelectedJackpotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Load jackpots list.
  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    jackpotsApi
      .listJackpots({ limit: 100 })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.items ?? []).map(toJackpotRow);
        setJackpots(rows);
        if (!selectedJackpotId && rows.length > 0) {
          setSelectedJackpotId(rows[0].id);
        }
      })
      .catch((err: Error) =>
        toast(`Failed to load jackpots: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, canView, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load tickets for the selected jackpot when on a tickets tab.
  useEffect(() => {
    if (!isAuth || !canView) return;
    if (activeTab === 'jackpots' || !selectedJackpotId) {
      setTickets([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    jackpotsApi
      .listJackpotTickets(selectedJackpotId, {
        type: activeTab === 'online' ? 'online' : 'offline',
        limit: 300,
      })
      .then((res) => {
        if (cancelled) return;
        setTickets((res.items ?? []).map(toTicketRow));
      })
      .catch((err: Error) =>
        toast(`Failed to load tickets: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, canView, activeTab, selectedJackpotId, reloadTick]);

  const handleSettle = async (row: JackpotRow) => {
    if (!window.confirm(`Settle jackpot "${row.name}"? Winners will be paid.`)) {
      return;
    }
    setBusyAction(row.id);
    try {
      const res = await jackpotsApi.settleJackpot(row.id, {});
      toast(
        `Settled — ${res.winners_count} winner(s) paid ${res.total_paid.toFixed(
          2
        )} ${row.currency}.`
      );
      setReloadTick((t) => t + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to settle';
      toast(msg, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (row: JackpotRow) => {
    if (!window.confirm(`Delete jackpot "${row.name}"?`)) return;
    setBusyAction(row.id);
    try {
      await jackpotsApi.deleteJackpot(row.id);
      toast('Jackpot deleted.');
      setReloadTick((t) => t + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete jackpot';
      toast(msg, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const tabs = [
    { id: 'jackpots', label: 'Super Jackpots' },
    { id: 'online', label: 'Online Jackpot Tickets' },
    { id: 'offline', label: 'Offline Jackpot Tickets' },
  ];

  const jackpotColumns = useMemo(
    () => [
      { header: 'Name', accessor: 'name' as const },
      { header: 'Status', accessor: 'status' as const },
      {
        header: 'Entry Fee',
        accessor: 'entry_fee' as const,
        render: (v: number, r: JackpotRow) => `${v.toFixed(2)} ${r.currency}`,
      },
      {
        header: 'Prize Pool',
        accessor: 'prize_pool' as const,
        render: (v: number, r: JackpotRow) => `${v.toFixed(2)} ${r.currency}`,
      },
      { header: 'Events', accessor: 'events' as const },
      { header: 'Tickets', accessor: 'tickets' as const },
      { header: 'Activation', accessor: 'starts_at' as const },
      { header: 'Ends', accessor: 'ends_at' as const },
      {
        header: 'Actions',
        accessor: 'id' as const,
        render: (_id: string, row: JackpotRow) => (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSelectedJackpotId(row.id);
                setActiveTab('online');
              }}
              className="text-blue-600 hover:text-blue-800"
              title="View tickets"
            >
              <Trophy className="h-4 w-4" />
            </button>
            {row.raw.status !== 'completed' &&
              row.raw.status !== 'cancelled' && (
                <button
                  onClick={() => handleSettle(row)}
                  className="text-green-600 hover:text-green-800 disabled:opacity-50"
                  disabled={busyAction === row.id}
                  title="Settle jackpot"
                >
                  <Award className="h-4 w-4" />
                </button>
              )}
            {row.tickets === 0 && (
              <button
                onClick={() => handleDelete(row)}
                className="text-red-600 hover:text-red-800 disabled:opacity-50"
                disabled={busyAction === row.id}
                title="Delete jackpot"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [busyAction]
  );

  const ticketColumnsOnline = useMemo(
    () => [
      { header: 'Date', accessor: 'date' as const },
      { header: 'Ticket ID', accessor: 'ticketId' as const },
      { header: 'User', accessor: 'user' as const },
      { header: 'Phone', accessor: 'phone' as const },
      {
        header: 'Stake',
        accessor: 'stake' as const,
        render: (v: number) => v.toFixed(2),
      },
      { header: 'Jackpot', accessor: 'jackpotName' as const },
      { header: 'Selections', accessor: 'selections' as const },
      {
        header: 'Status',
        accessor: 'status' as const,
        render: (s: string) => {
          const cls =
            s === 'won'
              ? 'bg-green-100 text-green-800'
              : s === 'lost'
              ? 'bg-gray-100 text-gray-800'
              : 'bg-yellow-100 text-yellow-800';
          return (
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}
            >
              {s}
            </span>
          );
        },
      },
      {
        header: 'Payout',
        accessor: 'payout' as const,
        render: (v: number) => v.toFixed(2),
      },
    ],
    []
  );

  const ticketColumnsOffline = useMemo(
    () => [
      ...ticketColumnsOnline.slice(0, 4),
      { header: 'Cashier', accessor: 'cashier' as const },
      { header: 'Branch', accessor: 'branch' as const },
      ...ticketColumnsOnline.slice(4),
    ],
    [ticketColumnsOnline]
  );

  if (!canView) {
    return (
      <div className="bg-white p-8 rounded-lg shadow text-center text-gray-600">
        Restricted page — Admin / Super Admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Trophy className="h-8 w-8 text-yellow-500" />
          <h1 className="text-2xl font-semibold text-gray-900">Super Jackpots</h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {activeTab === 'jackpots' && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Jackpot
            </button>
          )}
        </div>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as typeof activeTab)}
      />

      {activeTab !== 'jackpots' && (
        <div className="bg-white p-4 rounded-lg shadow flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">Jackpot:</label>
          <select
            value={selectedJackpotId ?? ''}
            onChange={(e) => setSelectedJackpotId(e.target.value || null)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
          >
            {jackpots.length === 0 && <option value="">No jackpots</option>}
            {jackpots.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.status})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        {activeTab === 'jackpots' ? (
          <DataTable columns={jackpotColumns} data={jackpots} />
        ) : (
          <DataTable
            columns={
              activeTab === 'online' ? ticketColumnsOnline : ticketColumnsOffline
            }
            data={tickets}
          />
        )}
        {loading && (
          <div className="px-6 pb-6 text-sm text-gray-500">Loading…</div>
        )}
      </div>

      <CreateJackpotModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => setReloadTick((t) => t + 1)}
      />
    </div>
  );
}
