import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Gamepad2, Plus, FileDown, RefreshCw, Eye, Power, PowerOff } from 'lucide-react';
import { GameModal } from './GameModal';
import { CategoryModal } from './CategoryModal';
import { TagModal } from './TagModal';
import { toast } from '../../lib/toast';
import * as casinoApi from '../../lib/api/casino';
import * as sportsbookApi from '../../lib/api/sportsbook';

interface SummaryReportData {
  bets: { count: number; totalStake: number };
  payouts: { count: number; totalAmount: number };
  rollbacks: { count: number; totalAmount: number };
  fees: { totalPayout: number; totalStake: number };
  ggr: { amount: number; percentage: number; rtp: number };
}

interface UserReportData {
  date: string;
  userName: string;
  phoneNumber: string;
  betCount: number;
  betAmount: number;
  payoutAmount: number;
  ggr: number;
}

interface GameReportData {
  date: string;
  gameName: string;
  betCount: number;
  betAmount: number;
  payoutAmount: number;
  ggr: number;
}

interface UserGameReportData {
  date: string;
  userName: string;
  phoneNumber: string;
  gameName: string;
  betCount: number;
  betAmount: number;
  payoutAmount: number;
  ggr: number;
}

interface UserDetailReportData {
  date: string;
  betId: string;
  gameName: string;
  betAmount: number;
  paidAmount: number;
  totalStakeFee: number;
}

interface GameData {
  id: string;
  order: number;
  name: string;
  label: string;
  status: string;
  /** Underlying boolean from the API — drives the toggle button state. */
  isActive: boolean;
  provider: string;
  categories: string[];
  tags: string[];
  description: string;
  weight: number;
  logo: string;
  slug: string;
  labelBackground: string;
}

interface CategoryData {
  id: string;
  order: number;
  name: string;
  description: string;
  isVisible: boolean;
  logo: string;
  slug: string;
  label: string;
  status: string;
  isActive: boolean;
}

interface ProviderData {
  id: string;
  name: string;
  image: string;
  order: number;
  status: string;
  isActive: boolean;
}

interface TagData {
  id: string;
  order: number;
  name: string;
  slug: string;
  status: string;
  showOnLobby: boolean;
  phoneTemplate: 'two-columns' | 'three-columns';
  image: string;
  games: string[];
}

const EMPTY_SUMMARY: SummaryReportData = {
  bets: { count: 0, totalStake: 0 },
  payouts: { count: 0, totalAmount: 0 },
  rollbacks: { count: 0, totalAmount: 0 },
  fees: { totalPayout: 0, totalStake: 0 },
  ggr: { amount: 0, percentage: 0, rtp: 0 },
};

export function Casino() {
  const [activeTab, setActiveTab] = useState('report');
  const [activeReportTab, setActiveReportTab] = useState('summary');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedGame, setSelectedGame] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isGameModalOpen, setIsGameModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<
    GameData | CategoryData | TagData | null
  >(null);
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<SummaryReportData>(EMPTY_SUMMARY);
  const [userReports, setUserReports] = useState<UserReportData[]>([]);
  const [gameReports, setGameReports] = useState<GameReportData[]>([]);
  const [userGameReports, setUserGameReports] = useState<UserGameReportData[]>([]);
  const [userDetailReports, setUserDetailReports] = useState<UserDetailReportData[]>([]);

  const [games, setGames] = useState<GameData[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [providers, setProviders] = useState<ProviderData[]>([]);
  const [tags, setTags] = useState<TagData[]>([]);

  const mainTabs = [
    { id: 'report', label: 'Report' },
    { id: 'games', label: 'Games' },
    { id: 'categories', label: 'Categories' },
    { id: 'providers', label: 'Providers' },
    { id: 'tags', label: 'Tags' },
  ];

  const reportTabs = [
    { id: 'summary', label: 'Summary Report' },
    { id: 'users', label: 'Users Report' },
    { id: 'games', label: 'Game Report' },
    { id: 'user-game', label: 'User-Game Report' },
    { id: 'user-detail', label: 'User Detail Report' },
  ];

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [gamesRes, categoriesRes, providersRes, tagsRes, betsRes] = await Promise.all([
        casinoApi.listGames({ limit: 500 }),
        casinoApi.listCategories(),
        casinoApi.listProviders(),
        casinoApi.listTags(),
        sportsbookApi.listBets({ page: 1, limit: 500 }).catch(() => ({ items: [] as Array<Record<string, unknown>> })),
      ]);

      const providerMap = new Map<string, ProviderData>();
      (providersRes.items ?? []).forEach((p, idx) => {
        providerMap.set(p.id, {
          id: p.id,
          name: p.name,
          image:
            p.logo_url ??
            String((p.config?.logo as string | undefined) ?? ''),
          order: idx + 1,
          status: p.is_active ? 'Active' : 'Inactive',
          isActive: p.is_active,
        });
      });

      const categoryMap = new Map<string, CategoryData>();
      (categoriesRes.items ?? []).forEach((c) => {
        categoryMap.set(c.id, {
          id: c.id,
          order: c.display_order ?? 100,
          name: c.name,
          description: '',
          isVisible: c.is_active,
          logo: c.icon_url ?? '',
          slug: c.slug,
          label: c.name,
          status: c.is_active ? 'Active' : 'Inactive',
          isActive: c.is_active,
        });
      });

      const tagMap = new Map<string, string>();
      (tagsRes.items ?? []).forEach((t) => tagMap.set(t.id, t.name));

      const mappedProviders = Array.from(providerMap.values());
      const mappedCategories = Array.from(categoryMap.values());
      const mappedTags: TagData[] = (tagsRes.items ?? []).map((t, idx) => ({
        id: t.id,
        order: idx + 1,
        name: t.name,
        slug: t.slug,
        status: 'Active',
        showOnLobby: false,
        phoneTemplate: 'two-columns',
        image: '',
        games: [],
      }));

      const mappedGames: GameData[] = (gamesRes.items ?? []).map((g) => ({
        id: g.id,
        order: g.display_order ?? 100,
        name: g.name,
        label: g.is_featured ? 'Featured' : '',
        status: g.is_active ? 'Active' : 'Inactive',
        isActive: g.is_active,
        provider:
          (g.provider_name && String(g.provider_name)) ||
          (g.provider_id && providerMap.get(g.provider_id)?.name) ||
          'Unknown',
        categories: g.category_id
          ? [categoryMap.get(g.category_id)?.name ?? '']
              .filter(Boolean)
          : [],
        tags: (g.tag_ids ?? [])
          .map((tid) => tagMap.get(tid) ?? '')
          .filter(Boolean),
        description: '',
        weight: Number(g.rtp ?? 0),
        logo: g.image_url ?? '',
        slug: g.slug ?? '',
        labelBackground: '',
      }));

      setProviders(mappedProviders);
      setCategories(mappedCategories);
      setTags(mappedTags);
      setGames(mappedGames);

      const bets = (betsRes.items ?? []) as Array<{
        id: string;
        status?: string;
        stake?: string | number;
        actual_payout?: string | number;
        potential_payout?: string | number;
        placed_at?: string;
        metadata?: Record<string, unknown>;
      }>;
      const wonBets = bets.filter((b) => b.status === 'won');
      const rollbackBets = bets.filter(
        (b) => b.status === 'void' || b.status === 'cancelled'
      );
      const totalStake = bets.reduce((sum, b) => sum + Number(b.stake ?? 0), 0);
      const totalPayout = wonBets.reduce(
        (sum, b) => sum + Number(b.actual_payout ?? b.potential_payout ?? 0),
        0
      );
      const ggrAmount = totalStake - totalPayout;

      setSummary({
        bets: { count: bets.length, totalStake },
        payouts: { count: wonBets.length, totalAmount: totalPayout },
        rollbacks: {
          count: rollbackBets.length,
          totalAmount: rollbackBets.reduce(
            (sum, b) => sum + Number(b.stake ?? 0),
            0
          ),
        },
        fees: { totalPayout: 0, totalStake: 0 },
        ggr: {
          amount: ggrAmount,
          percentage: totalStake > 0 ? (ggrAmount / totalStake) * 100 : 0,
          rtp: totalStake > 0 ? (totalPayout / totalStake) * 100 : 0,
        },
      });

      const byUser = new Map<string, UserReportData>();
      const byGame = new Map<string, GameReportData>();
      const byUserGame = new Map<string, UserGameReportData>();
      const userDetails: UserDetailReportData[] = [];

      bets.forEach((b) => {
        const stake = Number(b.stake ?? 0);
        const payout = Number(b.actual_payout ?? b.potential_payout ?? 0);
        const date = b.placed_at ? new Date(b.placed_at).toLocaleDateString() : '—';
        const userName = String((b.metadata?.full_name as string | undefined) ?? 'Unknown');
        const phone = String((b.metadata?.phone as string | undefined) ?? '—');
        const gameName = String((b.metadata?.game_name as string | undefined) ?? 'Unknown');

        const userKey = `${userName}|${phone}|${date}`;
        const gameKey = `${gameName}|${date}`;
        const userGameKey = `${userName}|${phone}|${gameName}|${date}`;

        if (!byUser.has(userKey)) {
          byUser.set(userKey, {
            date,
            userName,
            phoneNumber: phone,
            betCount: 0,
            betAmount: 0,
            payoutAmount: 0,
            ggr: 0,
          });
        }
        if (!byGame.has(gameKey)) {
          byGame.set(gameKey, {
            date,
            gameName,
            betCount: 0,
            betAmount: 0,
            payoutAmount: 0,
            ggr: 0,
          });
        }
        if (!byUserGame.has(userGameKey)) {
          byUserGame.set(userGameKey, {
            date,
            userName,
            phoneNumber: phone,
            gameName,
            betCount: 0,
            betAmount: 0,
            payoutAmount: 0,
            ggr: 0,
          });
        }

        const userRow = byUser.get(userKey)!;
        userRow.betCount += 1;
        userRow.betAmount += stake;
        userRow.payoutAmount += payout;
        userRow.ggr += stake - payout;

        const gameRow = byGame.get(gameKey)!;
        gameRow.betCount += 1;
        gameRow.betAmount += stake;
        gameRow.payoutAmount += payout;
        gameRow.ggr += stake - payout;

        const userGameRow = byUserGame.get(userGameKey)!;
        userGameRow.betCount += 1;
        userGameRow.betAmount += stake;
        userGameRow.payoutAmount += payout;
        userGameRow.ggr += stake - payout;

        userDetails.push({
          date,
          betId: b.id,
          gameName,
          betAmount: stake,
          paidAmount: payout,
          totalStakeFee: Number((b.metadata?.stake_fee as number | undefined) ?? 0),
        });
      });

      setUserReports(Array.from(byUser.values()));
      setGameReports(Array.from(byGame.values()));
      setUserGameReports(Array.from(byUserGame.values()));
      setUserDetailReports(userDetails);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to load casino data: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleToggleGame = useCallback(
    async (gameId: string, nextActive: boolean) => {
      try {
        await casinoApi.toggleGameStatus(gameId, nextActive);
        toast(nextActive ? 'Game enabled.' : 'Game disabled.');
        await loadCatalog();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast(`Failed to update game: ${message}`, 'error');
      }
    },
    [loadCatalog]
  );

  const commonFilters = [
    {
      label: 'Phone Number',
      options: [],
      value: phoneNumber,
      onChange: setPhoneNumber,
      type: 'text',
    },
    {
      label: 'Game',
      options: games.map((g) => g.name),
      value: selectedGame,
      onChange: setSelectedGame,
    },
    {
      label: 'Provider',
      options: providers.map((p) => p.name),
      value: selectedProvider,
      onChange: setSelectedProvider,
    },
  ];

  const filteredGames = useMemo(
    () =>
      games.filter((g) => {
        if (searchTerm && !g.name.toLowerCase().includes(searchTerm.toLowerCase()))
          return false;
        if (selectedProvider && g.provider !== selectedProvider) return false;
        if (selectedStatus && g.status !== selectedStatus) return false;
        return true;
      }),
    [games, searchTerm, selectedProvider, selectedStatus]
  );

  const gameColumns = [
    { header: 'Order', accessor: 'order' as const },
    { header: 'Name', accessor: 'name' as const },
    { header: 'Label', accessor: 'label' as const },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (value: string) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            value === 'Active'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {value}
        </span>
      ),
    },
    { header: 'Provider', accessor: 'provider' as const },
    {
      header: 'Categories',
      accessor: 'categories' as const,
      render: (value: string[]) => value.join(', '),
    },
    {
      header: 'Tags',
      accessor: 'tags' as const,
      render: (value: string[]) => value.join(', '),
    },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => {
        const game = games.find((g) => g.id === value);
        if (!game) return null;
        return (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSelectedItem(game);
                setIsGameModalOpen(true);
              }}
              className="text-blue-600 hover:text-blue-800"
              title="View game"
            >
              <Eye className="h-5 w-5" />
            </button>
            <button
              onClick={() => void handleToggleGame(game.id, !game.isActive)}
              className={
                game.isActive
                  ? 'text-red-600 hover:text-red-800'
                  : 'text-green-600 hover:text-green-800'
              }
              title={game.isActive ? 'Disable game' : 'Enable game'}
            >
              {game.isActive ? (
                <PowerOff className="h-5 w-5" />
              ) : (
                <Power className="h-5 w-5" />
              )}
            </button>
          </div>
        );
      },
    },
  ];

  const categoryColumns = [
    { header: 'Order', accessor: 'order' as const },
    { header: 'Name', accessor: 'name' as const },
    { header: 'Is Visible', accessor: 'isVisible' as const },
    { header: 'Status', accessor: 'status' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => (
        <button
          onClick={() => {
            const category = categories.find((c) => c.id === value);
            if (category) {
              setSelectedItem(category);
              setIsCategoryModalOpen(true);
            }
          }}
          className="text-blue-600 hover:text-blue-800"
        >
          <Eye className="h-5 w-5" />
        </button>
      ),
    },
  ];

  const tagColumns = [
    { header: 'Order', accessor: 'order' as const },
    { header: 'Name', accessor: 'name' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Show on Lobby', accessor: 'showOnLobby' as const },
    { header: 'Phone Template', accessor: 'phoneTemplate' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => (
        <button
          onClick={() => {
            const tag = tags.find((t) => t.id === value);
            if (tag) {
              setSelectedItem(tag);
              setIsTagModalOpen(true);
            }
          }}
          className="text-blue-600 hover:text-blue-800"
        >
          <Eye className="h-5 w-5" />
        </button>
      ),
    },
  ];

  const getReportColumns = () => {
    switch (activeReportTab) {
      case 'users':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'User Name', accessor: 'userName' as const },
          { header: 'Phone Number', accessor: 'phoneNumber' as const },
          { header: 'Bet Count', accessor: 'betCount' as const },
          { header: 'Bet Amount', accessor: 'betAmount' as const },
          { header: 'Payout Amount', accessor: 'payoutAmount' as const },
          { header: 'GGR', accessor: 'ggr' as const },
        ];
      case 'games':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'Game Name', accessor: 'gameName' as const },
          { header: 'Bet Count', accessor: 'betCount' as const },
          { header: 'Bet Amount', accessor: 'betAmount' as const },
          { header: 'Payout Amount', accessor: 'payoutAmount' as const },
          { header: 'GGR', accessor: 'ggr' as const },
        ];
      case 'user-game':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'User Name', accessor: 'userName' as const },
          { header: 'Phone Number', accessor: 'phoneNumber' as const },
          { header: 'Game Name', accessor: 'gameName' as const },
          { header: 'Bet Count', accessor: 'betCount' as const },
          { header: 'Bet Amount', accessor: 'betAmount' as const },
          { header: 'Payout Amount', accessor: 'payoutAmount' as const },
          { header: 'GGR', accessor: 'ggr' as const },
        ];
      case 'user-detail':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'Bet ID', accessor: 'betId' as const },
          { header: 'Game Name', accessor: 'gameName' as const },
          { header: 'Bet Amount', accessor: 'betAmount' as const },
          { header: 'Paid Amount', accessor: 'paidAmount' as const },
          { header: 'Total Stake Fee', accessor: 'totalStakeFee' as const },
        ];
      default:
        return [];
    }
  };

  const getReportData = () => {
    switch (activeReportTab) {
      case 'users':
        return userReports;
      case 'games':
        return gameReports;
      case 'user-game':
        return userGameReports;
      case 'user-detail':
        return userDetailReports;
      default:
        return [];
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Gamepad2 className="h-8 w-8 text-purple-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Casino Management</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('Casino report exported.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Data
          </button>
        </div>
      </div>

      <TabGroup tabs={mainTabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'report' && (
        <>
          <TabGroup
            tabs={reportTabs}
            activeTab={activeReportTab}
            onTabChange={setActiveReportTab}
          />

          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={commonFilters}
          />

          {activeReportTab === 'summary' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-medium mb-4">Bets</h3>
                <p className="text-sm text-gray-500">Count</p>
                <p className="text-xl font-semibold">{summary.bets.count.toLocaleString()}</p>
                <p className="text-sm text-gray-500 mt-2">Total Stake</p>
                <p className="text-xl font-semibold">${summary.bets.totalStake.toLocaleString()}</p>
              </div>
              <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-medium mb-4">Payouts</h3>
                <p className="text-sm text-gray-500">Count</p>
                <p className="text-xl font-semibold">{summary.payouts.count.toLocaleString()}</p>
                <p className="text-sm text-gray-500 mt-2">Total Amount</p>
                <p className="text-xl font-semibold">${summary.payouts.totalAmount.toLocaleString()}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-medium mb-4">Rollbacks</h3>
                <p className="text-sm text-gray-500">Count</p>
                <p className="text-xl font-semibold">{summary.rollbacks.count.toLocaleString()}</p>
                <p className="text-sm text-gray-500 mt-2">Total Amount</p>
                <p className="text-xl font-semibold">${summary.rollbacks.totalAmount.toLocaleString()}</p>
              </div>
              <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-medium mb-4">GGR</h3>
                <p className="text-sm text-gray-500">Amount</p>
                <p className="text-xl font-semibold">${summary.ggr.amount.toLocaleString()}</p>
                <p className="text-sm text-gray-500 mt-2">GGR % / RTP</p>
                <p className="text-xl font-semibold">
                  {summary.ggr.percentage.toFixed(2)}% / {summary.ggr.rtp.toFixed(2)}%
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow">
              <DataTable columns={getReportColumns()} data={getReportData()} />
            </div>
          )}
        </>
      )}

      {activeTab === 'games' && (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={[
              {
                label: 'Search',
                options: [],
                value: searchTerm,
                onChange: setSearchTerm,
                type: 'text',
              },
              {
                label: 'Provider',
                options: providers.map((p) => p.name),
                value: selectedProvider,
                onChange: setSelectedProvider,
              },
              {
                label: 'Category',
                options: categories.map((c) => c.name),
                value: selectedCategory,
                onChange: setSelectedCategory,
              },
              {
                label: 'Status',
                options: ['Active', 'Inactive'],
                value: selectedStatus,
                onChange: setSelectedStatus,
              },
            ]}
          />
          <div className="bg-white rounded-lg shadow">
            <DataTable columns={gameColumns} data={filteredGames} />
          </div>
        </>
      )}

      {activeTab === 'categories' && (
        <>
          <div className="flex justify-between mb-4">
            <FilterBar
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              filters={[
                {
                  label: 'Status',
                  options: ['Active', 'Inactive'],
                  value: selectedStatus,
                  onChange: setSelectedStatus,
                },
              ]}
            />
            <button
              onClick={() => {
                setSelectedItem(null);
                setIsCategoryModalOpen(true);
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Category
            </button>
          </div>
          <div className="bg-white rounded-lg shadow">
            <DataTable columns={categoryColumns} data={categories} />
          </div>
        </>
      )}

      {activeTab === 'providers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {providers.map((provider) => (
            <div key={provider.id} className="bg-white rounded-lg shadow-sm p-6">
              {provider.image ? (
                <img
                  src={provider.image}
                  alt={provider.name}
                  className="w-full h-32 object-cover rounded-lg mb-4"
                />
              ) : (
                <div className="w-full h-32 bg-gray-100 rounded-lg mb-4" />
              )}
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">{provider.name}</h3>
                <span
                  className={`px-2 py-1 rounded-full text-sm font-medium ${
                    provider.status === 'Active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {provider.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tags' && (
        <>
          <div className="flex justify-between mb-4">
            <button
              onClick={() => {
                setSelectedItem(null);
                setIsTagModalOpen(true);
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Tag
            </button>
          </div>
          <div className="bg-white rounded-lg shadow">
            <DataTable columns={tagColumns} data={tags} />
          </div>
        </>
      )}

      <GameModal
        isOpen={isGameModalOpen}
        onClose={() => setIsGameModalOpen(false)}
        game={selectedItem}
        mode="view"
      />

      <CategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        category={selectedItem}
        mode={selectedItem ? 'edit' : 'add'}
        onSave={() => {
          toast('Category saved.');
          setIsCategoryModalOpen(false);
        }}
      />

      <TagModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        tag={selectedItem}
        mode={selectedItem ? 'edit' : 'add'}
        onSave={() => {
          toast('Tag saved.');
          setIsTagModalOpen(false);
        }}
      />

      {loading && <div className="text-sm text-gray-500">Loading casino data…</div>}
    </div>
  );
}

export default Casino;
