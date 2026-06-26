import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { toast } from '../../lib/toast';
import { Gift, Plus, Users, Calendar, Trophy, FileDown } from 'lucide-react';
import * as promotionsApi from '../../lib/api/promotions';
import { useAuthStore } from '../../store/auth';

interface RaffleRow {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  minDeposit: number;
  ticketsIssued: number;
  participants: number;
  status: string;
  drawMode: string;
}

interface WinnerRow {
  ticketId: string;
  userName: string;
  phoneNumber: string;
  prize: string;
  status: string;
}

const StatCard = ({
  icon: Icon,
  title,
  value,
  trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  trend?: string;
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-red-50 rounded-lg">
        <Icon className="h-6 w-6 text-red-600" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-gray-900">{value}</h3>
    <p className="text-sm text-gray-500 mt-1">{title}</p>
    {trend && <p className="text-sm text-red-600 mt-2">{trend}</p>}
  </div>
);

function mapRaffle(r: promotionsApi.AdminRaffle): RaffleRow {
  return {
    id: r.id,
    title: r.name,
    startDate: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : '—',
    endDate: r.end_date ? new Date(r.end_date).toISOString().slice(0, 10) : '—',
    minDeposit: Number(r.min_deposit ?? 0),
    ticketsIssued: Number(r.tickets_count ?? 0),
    participants: Number(r.tickets_count ?? 0),
    status: r.status,
    drawMode: r.draw_mode,
  };
}

function mapTicketRow(row: Record<string, unknown>): WinnerRow {
  return {
    ticketId: String(row.ticket_number ?? row.id ?? '—'),
    userName: String(row.user_email ?? row.user_id ?? '—'),
    phoneNumber: String(row.user_phone ?? '—'),
    prize: String(row.prize ?? 'Pending draw'),
    status: String(row.status ?? 'Pending'),
  };
}

export function Raffles() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('campaigns');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedStatus, setSelectedStatus] = useState('');
  const [raffles, setRaffles] = useState<RaffleRow[]>([]);
  const [tickets, setTickets] = useState<WinnerRow[]>([]);
  const [selectedRaffleId, setSelectedRaffleId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const selectedRaffle = useMemo(
    () => raffles.find((r) => r.id === selectedRaffleId) ?? null,
    [raffles, selectedRaffleId]
  );

  const reloadRaffles = async () => {
    setLoading(true);
    try {
      const res = await promotionsApi.listAdminRaffles({ limit: 200 });
      const mapped = (res.items ?? []).map(mapRaffle);
      setRaffles(mapped);
      if (!selectedRaffleId && mapped[0]?.id) setSelectedRaffleId(mapped[0].id);
    } catch (err) {
      toast(`Failed to load raffles: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuth) return;
    void reloadRaffles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  useEffect(() => {
    if (!isAuth || !selectedRaffleId) return;
    promotionsApi
      .listAdminRaffleTickets(selectedRaffleId)
      .then((res) => setTickets((res.items ?? []).map((r) => mapTicketRow(r as Record<string, unknown>))))
      .catch((err: Error) => toast(`Failed to load raffle tickets: ${err.message ?? err}`, 'error'));
  }, [isAuth, selectedRaffleId]);

  const createQuickRaffle = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const now = new Date();
      const draw = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await promotionsApi.createAdminRaffle({
        name: `Test Raffle ${now.toISOString().slice(0, 16).replace('T', ' ')}`,
        description: 'Test raffle created from admin panel',
        start_date: now.toISOString(),
        end_date: draw.toISOString(),
        min_deposit: 0,
        prize_pool: 0,
        currency: 'ETB',
        draw_mode: 'auto',
        notify_winners: true,
        prizes: [],
        status: 'Active',
      });
      toast('Test raffle created.');
      await reloadRaffles();
    } catch (err) {
      toast(`Failed to create raffle: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const drawSelected = async () => {
    if (!selectedRaffleId) {
      toast('Select a raffle first.', 'error');
      return;
    }
    try {
      await promotionsApi.drawAdminRaffle(selectedRaffleId);
      toast('Raffle draw executed.');
      const winners = await promotionsApi.listAdminRaffleWinners(selectedRaffleId);
      setTickets((winners.items ?? []).map((r) => mapTicketRow(r as Record<string, unknown>)));
      await reloadRaffles();
    } catch (err) {
      toast(`Draw failed: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const toggleSelected = async () => {
    if (!selectedRaffleId || !selectedRaffle) {
      toast('Select a raffle first.', 'error');
      return;
    }
    const nextStatus = selectedRaffle.status === 'Active' ? 'Cancelled' : 'Active';
    try {
      await promotionsApi.setAdminRaffleStatus(selectedRaffleId, nextStatus);
      toast(`Raffle ${nextStatus === 'Active' ? 'enabled' : 'disabled'}.`);
      await reloadRaffles();
    } catch (err) {
      toast(`Status update failed: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const tabs = [
    { id: 'campaigns', label: 'Raffle Campaigns' },
    { id: 'winners', label: 'Winner Management' },
  ];

  const filters = [
    {
      label: 'Status',
      options: ['Active', 'Pending', 'Completed', 'Cancelled'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const filteredRaffles = useMemo(
    () => raffles.filter((r) => !selectedStatus || r.status === selectedStatus),
    [raffles, selectedStatus]
  );

  const raffleColumns = [
    { header: 'Title', accessor: 'title' as const },
    { header: 'Start Date', accessor: 'startDate' as const },
    { header: 'End Date', accessor: 'endDate' as const },
    { header: 'Min Deposit', accessor: 'minDeposit' as const },
    { header: 'Tickets Issued', accessor: 'ticketsIssued' as const },
    { header: 'Participants', accessor: 'participants' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Draw Mode', accessor: 'drawMode' as const },
  ];

  const winnerColumns = [
    { header: 'Ticket ID', accessor: 'ticketId' as const },
    { header: 'User', accessor: 'userName' as const },
    { header: 'Phone', accessor: 'phoneNumber' as const },
    { header: 'Prize', accessor: 'prize' as const },
    { header: 'Status', accessor: 'status' as const },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Gift className="h-8 w-8 text-red-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Raffle Management</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => {
              const data = activeTab === 'campaigns' ? filteredRaffles : tickets;
              toast(`Export ${data.length} rows from selected tab.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
          <button
            onClick={() => void createQuickRaffle()}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            {creating ? 'Creating...' : 'Create Raffle'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={Gift} title="Active Raffles" value={loading ? '—' : String(raffles.filter((r) => r.status === 'Active').length)} trend="from API" />
        <StatCard icon={Users} title="Total Participants" value={loading ? '—' : String(raffles.reduce((acc, r) => acc + r.participants, 0))} trend="aggregated" />
        <StatCard icon={Trophy} title="Tickets Loaded" value={loading ? '—' : String(tickets.length)} trend="selected raffle" />
        <StatCard icon={Calendar} title="Next Draw" value={loading ? '—' : raffles[0]?.endDate ?? '—'} trend="nearest loaded raffle" />
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-1">Selected Raffle</label>
            <select
              value={selectedRaffleId}
              onChange={(e) => setSelectedRaffleId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">Select raffle...</option>
              {raffles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void toggleSelected()}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            {selectedRaffle?.status === 'Active' ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => void drawSelected()}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Draw Selected
          </button>
        </div>
      </div>

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setSelectedStatus('');
          setStartDate(new Date());
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <DataTable
          columns={activeTab === 'campaigns' ? raffleColumns : winnerColumns}
          data={activeTab === 'campaigns' ? filteredRaffles : tickets}
        />
      </div>
    </div>
  );
}
